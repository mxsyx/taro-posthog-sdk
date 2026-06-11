export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined }

export type Properties = Record<string, JsonValue | undefined>

export interface CaptureOptions {
    timestamp?: Date | string
    uuid?: string
    send_instantly?: boolean
    disable_geoip?: boolean
}

export interface CaptureResult {
    event: string
    properties: Properties
    distinct_id: string
    timestamp: string
    uuid: string
    type: string
    library: string
    library_version: string
}

export type BeforeSendFn = (event: CaptureResult) => CaptureResult | null | undefined

export interface BootstrapOptions {
    distinctID?: string
    isIdentifiedID?: boolean
}

export interface PageviewRoute {
    path?: string
    route?: string
    query?: Record<string, string | number | boolean | undefined>
    openType?: string
}

export interface PageviewTrackingOptions {
    capture_initial?: boolean
}

export interface PostHogMiniProgramOptions {
    api_host?: string
    flush_at?: number
    flush_interval?: number
    request_timeout?: number
    persistence_name?: string
    capture_pageview?: boolean
    debug?: boolean
    disable_geoip?: boolean
    bootstrap?: BootstrapOptions
    before_send?: BeforeSendFn
    get_pageview_properties?: (route: PageviewRoute) => Properties
    loaded?: (posthog: PostHogMiniProgramLike) => void
}

export interface PostHogMiniProgramLike {
    capture(event: string, properties?: Properties, options?: CaptureOptions): CaptureResult | undefined
    captureScreen(route?: PageviewRoute, properties?: Properties): CaptureResult | undefined
    capturePageview(route?: PageviewRoute, properties?: Properties): CaptureResult | undefined
    flush(): Promise<void>
}

export interface TaroPage {
    route?: string
    path?: string
    $taroPath?: string
    options?: Record<string, string | number | boolean | undefined>
}

export interface PersistedState {
    distinct_id?: string
    anonymous_id?: string
    device_id?: string
    super_properties?: Properties
    queue?: CaptureResult[]
}
