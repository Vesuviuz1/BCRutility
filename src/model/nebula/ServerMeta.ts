import { Server } from 'helios-distribution-types'

export interface UntrackedFilesOption {
    /**
     * The subdirectory these patterns will be applied to. Ex.
     * [ "files", "forgegemods" ]
     */
    appliesTo: string[]
    /**
     * Glob patterns to match against the file.
     */
    patterns: string[]
}

export interface ExternalHostOption {
    /**
     * The subdirectory these patterns will be applied to. Ex.
     * [ "files", "forgemods" ]
     */
    appliesTo: string[]
    /**
     * Glob patterns to match against the file. Each pattern is tested
     * against both the path relative to the subdirectory (ex.
     * "required/foo.jar") and the bare file name (ex. "foo.jar"), so
     * "foo-*.jar" matches regardless of which namespace it sits in.
     */
    patterns: string[]
    /**
     * The base url matched files are served from. The file's name is
     * appended to this value to form the final download url, so a file
     * named foo.jar with a baseUrl of "https://example.com/mods/"
     * resolves to "https://example.com/mods/foo.jar".
     *
     * Use this for files that cannot live in your main file host, such as
     * mod jars above GitHub's 100 MiB per-file limit. The file must still
     * exist locally so its size and MD5 can be computed.
     */
    baseUrl: string
}

export interface ServerMetaOptions {
    version?: string
    forgeVersion?: string
    neoforgeVersion?: string
    fabricVersion?: string
}

export function getDefaultServerMeta(id: string, version: string, options?: ServerMetaOptions): ServerMeta {

    const servMeta: ServerMeta = {
        meta: {
            version: options?.version ?? '1.0.0',
            name: `${id} (Minecraft ${version})`,
            description: `${id} Running Minecraft ${version}`,
            icon: 'How to set the server icon: https://github.com/dscalzi/Nebula#setting-the-server-icon',
            address: 'localhost:25565',
            discord: {
                shortId: '<FILL IN OR REMOVE DISCORD OBJECT>',
                largeImageText: '<FILL IN OR REMOVE DISCORD OBJECT>',
                largeImageKey: '<FILL IN OR REMOVE DISCORD OBJECT>'
            },
            mainServer: false,
            autoconnect: false
        }
    }

    if(options?.forgeVersion) {
        servMeta.meta.description = `${servMeta.meta.description} (Forge v${options.forgeVersion})`
        servMeta.forge = {
            version: options.forgeVersion
        }
    }

    if(options?.neoforgeVersion) {
        servMeta.meta.description = `${servMeta.meta.description} (NeoForge v${options.neoforgeVersion})`
        servMeta.neoforge = {
            version: options.neoforgeVersion
        }
    }

    if(options?.fabricVersion) {
        servMeta.meta.description = `${servMeta.meta.description} (Fabric v${options.fabricVersion})`
        servMeta.fabric = {
            version: options.fabricVersion
        }
    }

    // Add empty untracked files.
    servMeta.untrackedFiles = []

    return servMeta
}

export interface ServerMeta {

    /**
     * Server metadata to be forwarded to the distribution file.
     */
    meta: {
        version: Server['version']
        name: Server['name']
        description: Server['description']
        icon?: Server['icon']
        address: Server['address']
        discord?: Server['discord']
        mainServer: Server['mainServer']
        autoconnect: Server['autoconnect']
        javaOptions?: Server['javaOptions']
    }

    /**
     * Properties related to Forge.
     */
    forge?: {
        /**
         * The forge version. This does NOT include the minecraft version.
         * Ex. 14.23.5.2854
         */
        version: string
    }

    /**
     * Properties related to NeoForge.
     */
    neoforge?: {
        /**
         * The NeoForge version. NeoForge versions are derived from the Minecraft
         * version they target and do NOT include it as a prefix.
         * Ex. 21.1.262 for Minecraft 1.21.1
         */
        version: string
    }

    /**
     * Properties related to Fabric.
     */
    fabric?: {
        /**
         * The fabric loader version. This does NOT include the minecraft version.
         * Ex. 0.14.18
         */
        version: string
    }

    /**
     * A list of option objects defining patterns for untracked files.
     */
    untrackedFiles?: UntrackedFilesOption[]

    /**
     * A list of option objects redirecting matched files to an alternate
     * file host. Useful for files too large for your primary host.
     */
    externalHosts?: ExternalHostOption[]

}
