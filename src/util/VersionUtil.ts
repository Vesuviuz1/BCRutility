import got from 'got'
import { PromotionsSlim } from '../model/forge/PromotionsSlim.js'
import { MinecraftVersion } from './MinecraftVersion.js'
import { LoggerUtil } from './LoggerUtil.js'
import { FabricInstallerMeta, FabricLoaderMeta, FabricProfileJson, FabricVersionMeta } from '../model/fabric/FabricMeta.js'

export class VersionUtil {

    private static readonly logger = LoggerUtil.getLogger('VersionUtil')

    public static readonly PROMOTION_TYPE = [
        'recommended',
        'latest'
    ]

    public static isVersionAcceptable(version: MinecraftVersion, acceptable: number[]): boolean {
        if (version.getMajor() === 1) {
            return acceptable.find((element) => version.getMinor() === element) != null
        }
        return false
    }

    public static versionGte(version: string, min: string): boolean {

        if(version === min) {
            return true
        }

        const left = version.split('.').map(x => Number(x))
        const right = min.split('.').map(x => Number(x))

        if(left.length != right.length) {
            throw new Error('Cannot compare mismatched versions.')
        }

        for(let i=0; i<left.length; i++) {
            if(left[i] > right[i]) {
                return true
            }
        }

        return false
    }

    public static isPromotionVersion(version: string): boolean {
        return VersionUtil.PROMOTION_TYPE.includes(version.toLowerCase())
    }

    // -------------------------------
    // Forge

    public static isOneDotTwelveFG2(libraryVersion: string): boolean {
        const maxFG2 = [14, 23, 5, 2847]
        const verSplit = libraryVersion.split('.').map(v => Number(v))

        for(let i=0; i<maxFG2.length; i++) {
            if(verSplit[i] > maxFG2[i]) {
                return false
            }
        }
        
        return true
    }

    public static async getPromotionIndex(): Promise<PromotionsSlim> {
        const response = await got.get<PromotionsSlim>({
            method: 'get',
            url: 'https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json',
            responseType: 'json'
        })
        return response.body
    }

    public static getPromotedVersionStrict(index: PromotionsSlim, minecraftVersion: MinecraftVersion, promotion: string): string {
        const workingPromotion = promotion.toLowerCase()
        return index.promos[`${minecraftVersion}-${workingPromotion}`]
    }

    public static async getPromotedForgeVersion(minecraftVersion: MinecraftVersion, promotion: string): Promise<string> {
        const workingPromotion = promotion.toLowerCase()
        const res = await VersionUtil.getPromotionIndex()
        let version = res.promos[`${minecraftVersion}-${workingPromotion}`]
        if (version == null) {
            VersionUtil.logger.warn(`No ${workingPromotion} version found for Forge ${minecraftVersion}.`)
            VersionUtil.logger.warn('Attempting to pull latest version instead.')
            version = res.promos[`${minecraftVersion}-latest`]
            if (version == null) {
                throw new Error(`No latest version found for Forge ${minecraftVersion}.`)
            }
        }
        return version
    }

    // -------------------------------
    // NeoForge

    public static readonly NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/'

    /**
     * NeoForge versions are derived from the Minecraft version they target.
     * Minecraft 1.21.1 -> 21.1.x, Minecraft 1.21 -> 21.0.x, Minecraft 1.20.2 -> 20.2.x
     *
     * @param minecraftVersion The Minecraft version.
     * @returns The NeoForge version prefix for the given Minecraft version (ex. '21.1.').
     */
    public static getNeoForgeVersionPrefix(minecraftVersion: MinecraftVersion): string {
        return `${minecraftVersion.getMinor()}.${minecraftVersion.getRevision() ?? 0}.`
    }

    /**
     * Retrieve every published NeoForge version, newest last.
     */
    public static async getNeoForgeVersions(): Promise<string[]> {
        const body = await got.get(
            `${VersionUtil.NEOFORGE_MAVEN}net/neoforged/neoforge/maven-metadata.xml`
        ).text()

        const versions: string[] = []
        const versionRegex = /<version>([^<]+)<\/version>/g
        let match: RegExpExecArray | null
        while((match = versionRegex.exec(body)) != null) {
            versions.push(match[1])
        }

        if(versions.length === 0) {
            throw new Error('Failed to parse NeoForge maven metadata. Did the format change?')
        }

        return versions
    }

    /**
     * Resolve a 'latest' or 'recommended' promotion to a concrete NeoForge version.
     *
     * NeoForge does not publish a promotions index like Forge does. Instead, versions
     * suffixed with '-beta' are considered pre-release. 'recommended' therefore resolves
     * to the newest stable (non-beta) build, and 'latest' to the newest build overall.
     *
     * @param minecraftVersion The Minecraft version.
     * @param promotion Either 'latest' or 'recommended'.
     */
    public static async getPromotedNeoForgeVersion(minecraftVersion: MinecraftVersion, promotion: string): Promise<string> {
        const workingPromotion = promotion.toLowerCase()
        const prefix = VersionUtil.getNeoForgeVersionPrefix(minecraftVersion)
        const all = await VersionUtil.getNeoForgeVersions()

        // Newest first.
        const candidates = all.filter(v => v.startsWith(prefix)).reverse()

        if(candidates.length === 0) {
            throw new Error(`No NeoForge versions found for Minecraft ${minecraftVersion}.`)
        }

        if(workingPromotion === 'recommended') {
            const stable = candidates.find(v => !v.endsWith('-beta'))
            if(stable != null) {
                return stable
            }
            VersionUtil.logger.warn(`No stable NeoForge version found for Minecraft ${minecraftVersion}.`)
            VersionUtil.logger.warn('Falling back to the latest version instead.')
        }

        return candidates[0]
    }

    // -------------------------------
    // Fabric

    public static async getFabricInstallerMeta(): Promise<FabricInstallerMeta[]> {
        const response = await got.get<FabricInstallerMeta[]>({
            method: 'get',
            url: 'https://meta.fabricmc.net/v2/versions/installer',
            responseType: 'json'
        })
        return response.body
    }

    public static async getFabricLoaderMeta(): Promise<FabricLoaderMeta[]> {
        const response = await got.get<FabricLoaderMeta[]>({
            method: 'get',
            url: 'https://meta.fabricmc.net/v2/versions/loader',
            responseType: 'json'
        })
        return response.body
    }

    public static async getFabricGameMeta(): Promise<FabricVersionMeta[]> {
        const response = await got.get<FabricVersionMeta[]>({
            method: 'get',
            url: 'https://meta.fabricmc.net/v2/versions/game',
            responseType: 'json'
        })
        return response.body
    }

    public static async getFabricProfileJson(gameVersion: string, loaderVersion: string): Promise<FabricProfileJson> {
        const response = await got.get<FabricProfileJson>({
            method: 'get',
            url: `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/profile/json`,
            responseType: 'json'
        })
        return response.body
    }

    public static async getPromotedFabricVersion(promotion: string): Promise<string> {
        const stable = promotion.toLowerCase() === 'recommended'
        const fabricLoaderMeta = await this.getFabricLoaderMeta()
        return !stable ? fabricLoaderMeta[0].version : fabricLoaderMeta.find(({ stable }) => stable)!.version
    }

}
