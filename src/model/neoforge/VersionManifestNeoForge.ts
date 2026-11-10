/**
 * The version manifest (version.json) shipped inside a NeoForge installer and
 * written to <root>/repo/versions by Nebula.
 *
 * Structurally this matches the modern (ForgeGradle 3+) Forge manifest, except
 * that NeoForge also declares JVM arguments. The launcher reads this file
 * verbatim, so every field must be preserved when it is copied into the repo.
 */
export interface VersionManifestNeoForge {

    id: string
    time: string
    releaseTime: string
    type: string
    mainClass: string
    inheritsFrom: string
    logging?: Record<string, unknown>
    arguments: {
        game: string[]
        jvm?: string[]
    }
    libraries: {
        name: string
        downloads: {
            artifact: {
                path: string
                url: string
                sha1: string
                size: number
            }
        }
    }[]

}
