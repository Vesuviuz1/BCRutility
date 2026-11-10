import { Module, Type } from 'helios-distribution-types'
import { pathExists, remove, mkdirs, copy } from 'fs-extra/esm'
import { lstat, readFile, writeFile } from 'fs/promises'
import { join, basename, dirname } from 'path'
import { spawn } from 'child_process'
import { createHash } from 'crypto'

import { BaseResolver } from '../BaseResolver.js'
import { RepoStructure } from '../../structure/repo/Repo.struct.js'
import { LibRepoStructure } from '../../structure/repo/LibRepo.struct.js'
import { MinecraftVersion } from '../../util/MinecraftVersion.js'
import { LoggerUtil } from '../../util/LoggerUtil.js'
import { MavenUtil } from '../../util/MavenUtil.js'
import { JavaUtil } from '../../util/java/JavaUtil.js'
import { VersionManifestNeoForge } from '../../model/neoforge/VersionManifestNeoForge.js'

interface GeneratedFile {
    name: string
    group: string
    artifact: string
    version: string
    classifiers: (string | undefined)[]
    skipIfNotPresent?: boolean
    classpath?: boolean
}

/**
 * Resolver for NeoForge (net.neoforged:neoforge).
 *
 * NeoForge split from Forge after Minecraft 1.20.1 and is the only modern loader
 * that still supports FML's `--fml.modLists` / `--fml.mavenRoots` arguments, which
 * is how Helios loads mods from its shared modstore. That makes it a drop-in
 * replacement for the Forge 1.17+ launch path on the launcher side -- the launcher
 * reads the main class, JVM arguments and game arguments straight out of the
 * version manifest this resolver publishes, so no launcher changes are required.
 *
 * Unlike the Forge installer, the NeoForge installer supports a headless
 * `--install-client <dir>` flag, so no manual GUI step is needed.
 */
export class NeoForgeResolver extends BaseResolver {

    private static readonly logger = LoggerUtil.getLogger('NeoForge Resolver')

    private static readonly WILDCARD_NEOFORM_VERSION = '${neoFormVersion}'

    protected readonly REMOTE_REPOSITORY = 'https://maven.neoforged.net/releases/'

    protected repoStructure: RepoStructure
    protected artifactVersion: string

    private generatedFiles: GeneratedFile[]

    constructor(
        absoluteRoot: string,
        relativeRoot: string,
        baseUrl: string,
        protected minecraftVersion: MinecraftVersion,
        protected neoforgeVersion: string,
        protected discardOutput: boolean,
        protected invalidateCache: boolean
    ) {
        super(absoluteRoot, relativeRoot, baseUrl)
        this.repoStructure = new RepoStructure(absoluteRoot, relativeRoot, 'neoforge')
        // NeoForge artifacts are versioned independently of Minecraft (ex. 21.1.262).
        this.artifactVersion = neoforgeVersion
        this.generatedFiles = this.configure()
    }

    /**
     * NeoForge only targets Minecraft 1.20.2 and above.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public static isForVersion(version: MinecraftVersion, libraryVersion: string): boolean {
        return version.isGreaterThanOrEqualTo(new MinecraftVersion('1.20.2'))
    }

    public isForVersion(version: MinecraftVersion, libraryVersion: string): boolean {
        return NeoForgeResolver.isForVersion(version, libraryVersion)
    }

    /**
     * Declare the artifacts the installer produces locally. These cannot be downloaded,
     * they are generated on this machine by the installer's processors, so Nebula must
     * copy them into the repo and publish them as modules.
     *
     * Derived from the installer's install_profile.json data block:
     *   PATCHED  -> [net.neoforged:neoforge:<ver>:client]
     *   MC_EXTRA -> [net.minecraft:client:<mc>-<neoform>:extra]
     *   MC_SLIM  -> [net.minecraft:client:<mc>-<neoform>:slim]
     *   MC_SRG   -> [net.minecraft:client:<mc>-<neoform>:srg]
     */
    private configure(): GeneratedFile[] {

        const neoFormUnifiedVersion = `${this.minecraftVersion}-${NeoForgeResolver.WILDCARD_NEOFORM_VERSION}`

        return [
            // The universal jar is the root module. It must come first -- process()
            // promotes the first entry to the ForgeHosted module that anchors the tree.
            {
                name: 'universal jar',
                group: LibRepoStructure.NEOFORGE_GROUP,
                artifact: LibRepoStructure.NEOFORGE_ARTIFACT,
                version: this.artifactVersion,
                classifiers: ['universal'],
                // Must NOT be on the classpath. NeoForge's version.json omits every
                // net.neoforged:neoforge artifact from its runtime libraries: FML
                // locates the universal jar via -DlibraryDirectory and loads it into
                // the game layer itself. On the classpath it instead defines the
                // net.minecraft packages in the boot layer, so the game layer's
                // lookups fall through to BuiltinClassLoader and die with
                // NoClassDefFoundError on the first Minecraft class touched.
                classpath: false
            },
            // The binary-patched Minecraft client. FML locates this through
            // -DlibraryDirectory rather than the classpath.
            {
                name: 'client jar',
                group: LibRepoStructure.NEOFORGE_GROUP,
                artifact: LibRepoStructure.NEOFORGE_ARTIFACT,
                version: this.artifactVersion,
                classifiers: ['client'],
                classpath: false
            },
            // Minecraft's non-class resources. Named in -DignoreList, so it is
            // deliberately kept off the module path.
            {
                name: 'client extra',
                group: LibRepoStructure.MINECRAFT_GROUP,
                artifact: LibRepoStructure.MINECRAFT_CLIENT_ARTIFACT,
                version: neoFormUnifiedVersion,
                classifiers: ['extra', 'extra-stable'],
                classpath: false
            },
            // Intermediate build artifacts. Present for parity with the Forge
            // resolver and for offline re-installs; not required at runtime.
            {
                name: 'client slim',
                group: LibRepoStructure.MINECRAFT_GROUP,
                artifact: LibRepoStructure.MINECRAFT_CLIENT_ARTIFACT,
                version: neoFormUnifiedVersion,
                classifiers: ['slim', 'slim-stable'],
                skipIfNotPresent: true,
                classpath: false
            },
            {
                name: 'client srg',
                group: LibRepoStructure.MINECRAFT_GROUP,
                artifact: LibRepoStructure.MINECRAFT_CLIENT_ARTIFACT,
                version: neoFormUnifiedVersion,
                classifiers: ['srg'],
                skipIfNotPresent: true,
                classpath: false
            }
        ]
    }

    public async getModule(): Promise<Module> {
        return this.process()
    }

    private async process(): Promise<Module> {
        const libRepo = this.repoStructure.getLibRepoStruct()

        // Get the installer.
        const installerPath = libRepo.getLocalNeoForge(this.artifactVersion, 'installer')
        NeoForgeResolver.logger.debug(`Checking for NeoForge installer at ${installerPath}..`)

        if (!await libRepo.artifactExists(installerPath)) {
            NeoForgeResolver.logger.debug('NeoForge installer not found locally, initializing download..')
            await libRepo.downloadArtifactByComponents(
                this.REMOTE_REPOSITORY,
                LibRepoStructure.NEOFORGE_GROUP,
                LibRepoStructure.NEOFORGE_ARTIFACT,
                this.artifactVersion, 'installer', 'jar'
            )
        } else {
            NeoForgeResolver.logger.debug('Using locally discovered NeoForge installer.')
        }

        if (!await libRepo.artifactExists(installerPath)) {
            throw new Error(
                `Failed to acquire the NeoForge installer for ${this.artifactVersion}. `
                + 'Verify that this version exists at https://maven.neoforged.net/releases/net/neoforged/neoforge/'
            )
        }

        NeoForgeResolver.logger.debug(
            `Beginning processing of NeoForge v${this.neoforgeVersion} (Minecraft ${this.minecraftVersion})`
        )

        return this.processWithInstaller(installerPath)
    }

    private async processWithInstaller(installerPath: string): Promise<Module> {

        let doInstall = true

        // Check cache.
        const cacheDir = this.repoStructure.getNeoForgeCacheDirectory(this.artifactVersion)
        if (await pathExists(cacheDir)) {
            if (this.invalidateCache) {
                NeoForgeResolver.logger.info(`Removing existing cache ${cacheDir}..`)
                await remove(cacheDir)
                await mkdirs(cacheDir)
            } else {
                doInstall = false
                NeoForgeResolver.logger.info(`Using cached results at ${cacheDir}.`)
            }
        } else {
            await mkdirs(cacheDir)
        }

        const installerOutputDir = cacheDir

        if (doInstall) {
            const workingInstaller = join(installerOutputDir, basename(installerPath))

            await copy(installerPath, workingInstaller)

            // Required for the installer to function.
            await writeFile(join(installerOutputDir, 'launcher_profiles.json'), JSON.stringify({}))

            NeoForgeResolver.logger.info('Running the NeoForge installer (headless)..')

            await this.executeInstaller(workingInstaller, installerOutputDir)

            NeoForgeResolver.logger.debug('Installer finished, beginning processing..')
        }

        await this.verifyInstallerRan(installerOutputDir)

        NeoForgeResolver.logger.debug('Processing Version Manifest')
        const [versionManifest, versionManifestModule] = await this.processVersionManifest(installerOutputDir)

        NeoForgeResolver.logger.debug('Processing generated NeoForge files.')
        const neoforgeModule = await this.processNeoForgeModule(versionManifest, installerOutputDir)

        // Attach version.json module.
        neoforgeModule.subModules?.unshift(versionManifestModule)

        NeoForgeResolver.logger.debug('Processing Libraries')
        const libs = await this.processLibraries(versionManifest, installerOutputDir)

        neoforgeModule.subModules = neoforgeModule.subModules?.concat(libs)

        if (this.discardOutput) {
            NeoForgeResolver.logger.info(`Removing installer output at ${installerOutputDir}..`)
            await remove(installerOutputDir)
            NeoForgeResolver.logger.info('Removed successfully.')
        }

        return neoforgeModule
    }

    /**
     * The installer writes its manifest to versions/neoforge-<version>/neoforge-<version>.json.
     */
    private getInstallerVersionName(): string {
        return `${LibRepoStructure.NEOFORGE_ARTIFACT}-${this.artifactVersion}`
    }

    private getVersionManifestPath(installerOutputDir: string): string {
        const versionName = this.getInstallerVersionName()
        return join(installerOutputDir, 'versions', versionName, `${versionName}.json`)
    }

    private async verifyInstallerRan(installerOutputDir: string): Promise<void> {
        const versionManifestPath = this.getVersionManifestPath(installerOutputDir)

        if (!await pathExists(versionManifestPath)) {
            await remove(installerOutputDir)
            throw new Error(
                'The NeoForge installer did not produce a version manifest at '
                + `${versionManifestPath}. Check the installer output above for errors, and ensure `
                + 'JAVA_EXECUTABLE in your .env points at Java 21 or newer for Minecraft 1.21+.'
            )
        }
    }

    private async processVersionManifest(installerOutputDir: string): Promise<[VersionManifestNeoForge, Module]> {
        const versionRepo = this.repoStructure.getVersionRepoStruct()
        const versionManifestPath = this.getVersionManifestPath(installerOutputDir)

        const versionManifestBuf = await readFile(versionManifestPath)
        const versionManifest = JSON.parse(versionManifestBuf.toString()) as VersionManifestNeoForge

        const versionManifestModule: Module = {
            // The launcher stores this file at versions/<id>/<id>.json. Using the
            // installer's own id keeps that path aligned with ${version_name},
            // which the JVM arguments interpolate into -DignoreList.
            id: versionManifest.id ?? this.getInstallerVersionName(),
            name: 'NeoForge (version.json)',
            type: Type.VersionManifest,
            artifact: this.generateArtifact(
                versionManifestBuf,
                await lstat(versionManifestPath),
                versionRepo.getVersionManifestURL(this.baseUrl, this.minecraftVersion, this.neoforgeVersion)
            )
        }

        const destination = versionRepo.getVersionManifest(
            this.minecraftVersion,
            this.neoforgeVersion
        )

        await copy(versionManifestPath, destination, { overwrite: true })

        return [versionManifest, versionManifestModule]
    }

    private async processNeoForgeModule(
        versionManifest: VersionManifestNeoForge,
        installerOutputDir: string
    ): Promise<Module> {

        const libDir = join(installerOutputDir, 'libraries')

        // Resolve the NeoForm version wildcard, which determines the version
        // component of the generated net.minecraft:client artifacts.
        const neoFormVersion = this.getNeoFormVersion(versionManifest.arguments.game)
        if (neoFormVersion == null) {
            throw new Error(
                'NeoForm version not found in the version manifest game arguments. '
                + 'Did NeoForge change their format?'
            )
        }

        const generatedFiles = this.generatedFiles.map(f => ({
            ...f,
            version: f.version.replace(NeoForgeResolver.WILDCARD_NEOFORM_VERSION, neoFormVersion)
        }))

        const mdls: Module[] = []

        for (const entry of generatedFiles) {

            const targetLocations: string[] = []
            let located = false

            classifierLoop:
            for (const _classifier of entry.classifiers) {

                const targetLocalPath = join(
                    libDir,
                    MavenUtil.mavenComponentsAsNormalizedPath(entry.group, entry.artifact, entry.version, _classifier)
                )

                targetLocations.push(targetLocalPath)

                if (await pathExists(targetLocalPath)) {

                    mdls.push({
                        id: MavenUtil.mavenComponentsToIdentifier(
                            entry.group,
                            entry.artifact,
                            entry.version,
                            _classifier
                        ),
                        name: `NeoForge (${entry.name})`,
                        type: Type.Library,
                        classpath: entry.classpath ?? true,
                        artifact: this.generateArtifact(
                            await readFile(targetLocalPath),
                            await lstat(targetLocalPath),
                            this.repoStructure.getLibRepoStruct().getArtifactUrlByComponents(
                                this.baseUrl,
                                entry.group,
                                entry.artifact,
                                entry.version,
                                _classifier
                            )
                        ),
                        subModules: []
                    })

                    const destination = this.repoStructure.getLibRepoStruct().getArtifactByComponents(
                        entry.group,
                        entry.artifact,
                        entry.version,
                        _classifier
                    )

                    await copy(targetLocalPath, destination, { overwrite: true })

                    located = true
                    break classifierLoop
                }
            }

            if (!entry.skipIfNotPresent && !located) {
                throw new Error(
                    `Required file ${entry.name} not found at any expected location:\n\t${targetLocations.join('\n\t')}`
                )
            }
        }

        // The universal jar anchors the module tree. The launcher locates the mod
        // loader by looking for a ForgeHosted module, and loads the version manifest
        // from its submodules.
        const neoforgeModule = mdls.shift()!
        neoforgeModule.type = Type.ForgeHosted
        neoforgeModule.subModules = mdls

        return neoforgeModule
    }

    private async processLibraries(
        manifest: VersionManifestNeoForge,
        installerOutputDir: string
    ): Promise<Module[]> {

        const libDir = join(installerOutputDir, 'libraries')
        const libRepo = this.repoStructure.getLibRepoStruct()

        const mdls: Module[] = []

        for (const entry of manifest.libraries) {
            const artifact = entry.downloads?.artifact

            if (artifact?.url == null || artifact.url.length === 0) {
                continue
            }

            const targetLocalPath = join(libDir, artifact.path)

            // The installer only materializes libraries it needs locally. Anything
            // missing is still downloadable, so fetch it rather than failing.
            if (!await pathExists(targetLocalPath)) {
                NeoForgeResolver.logger.debug(`Library ${entry.name} not present locally, downloading..`)
                await libRepo.downloadArtifactDirect(artifact.url, artifact.path)

                const downloaded = join(libRepo.getContainerDirectory(), artifact.path)
                if (!await pathExists(downloaded)) {
                    throw new Error(`Expected library ${entry.name} could not be resolved!`)
                }

                const buf = await readFile(downloaded)
                mdls.push(await this.buildLibraryModule(entry.name, buf, downloaded, libRepo))
                continue
            }

            const buf = await readFile(targetLocalPath)
            mdls.push(await this.buildLibraryModule(entry.name, buf, targetLocalPath, libRepo))

            const components = MavenUtil.getMavenComponents(entry.name)
            const destination = libRepo.getArtifactByComponents(
                components.group,
                components.artifact,
                components.version,
                components.classifier,
                components.extension
            )

            await copy(targetLocalPath, destination, { overwrite: true })
        }

        return mdls
    }

    private async buildLibraryModule(
        name: string,
        buf: Buffer,
        localPath: string,
        libRepo: LibRepoStructure
    ): Promise<Module> {
        const components = MavenUtil.getMavenComponents(name)

        return {
            id: name,
            name: `NeoForge (${components.artifact})`,
            type: Type.Library,
            artifact: this.generateArtifact(
                buf,
                await lstat(localPath),
                libRepo.getArtifactUrlByComponents(
                    this.baseUrl,
                    components.group,
                    components.artifact,
                    components.version,
                    components.classifier,
                    components.extension
                )
            )
        }
    }

    /**
     * Run the installer headlessly. NeoForge's installer accepts --install-client,
     * so unlike Forge there is no GUI step for the user to get wrong.
     */
    private executeInstaller(installerExec: string, targetDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const niLogger = LoggerUtil.getLogger('NeoForge Installer')
            const child = spawn(JavaUtil.getJavaExecutable(), [
                '-jar',
                installerExec,
                '--install-client',
                targetDir
            ], {
                cwd: dirname(installerExec)
            })

            child.stdout.on('data', (data) => niLogger.info(data.toString('utf8').trim()))
            child.stderr.on('data', (data) => niLogger.error(data.toString('utf8').trim()))

            child.on('error', err => reject(err))
            child.on('close', code => {
                if (code === 0) {
                    niLogger.info('Exited with code', code)
                    resolve()
                } else {
                    niLogger.error('Exited with code', code)
                    reject(new Error(
                        `The NeoForge installer exited with code ${code}. `
                        + 'Review the installer output above for the cause.'
                    ))
                }
            })
        })
    }

    /**
     * Extract the NeoForm version from the manifest's game arguments
     * (ex. '--fml.neoFormVersion', '20240808.144430').
     */
    private getNeoFormVersion(args: string[]): string | null {
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--fml.neoFormVersion') {
                return args[i + 1] ?? null
            }
        }
        return null
    }

    /**
     * Verify a local artifact against an expected SHA-1, used to detect partial downloads.
     */
    protected static async matchesSha1(path: string, expected: string): Promise<boolean> {
        const buf = await readFile(path)
        return createHash('sha1').update(buf).digest('hex') === expected
    }

}
