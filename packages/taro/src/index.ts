import Taro from '@tarojs/taro'
import { version } from './version'
import type {
    CaptureOptions,
    CaptureResult,
    PageviewRoute,
    PageviewTrackingOptions,
    PersistedState,
    PostHogMiniProgramOptions,
    Properties,
    TaroPage,
} from './types'

declare const setTimeout: (handler: () => void, timeout?: number) => unknown
declare const clearTimeout: (timeoutId: unknown) => void
declare const console: { log: (message?: unknown, ...optionalParams: unknown[]) => void }
declare const getCurrentPages: (() => TaroPage[]) | undefined

export * from './types'

const DEFAULT_HOST = 'https://us.i.posthog.com'
const DEFAULT_FLUSH_AT = 20
const DEFAULT_FLUSH_INTERVAL = 10000
const DEFAULT_REQUEST_TIMEOUT = 10000
const LIBRARY = 'miniprogram'

type TaroWithRouteEvents = typeof Taro & {
    onAppRoute?: (callback: (route: PageviewRoute) => void) => void
    offAppRoute?: (callback: (route: PageviewRoute) => void) => void
}

const taro = Taro as TaroWithRouteEvents

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const now = (): string => new Date().toISOString()

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)

const stringifyQuery = (query?: PageviewRoute['query']): string => {
    if (!query) {
        return ''
    }

    const parts = Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)

    return parts.length ? `?${parts.join('&')}` : ''
}

const createUuid = (): string => {
    const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    return template.replace(/[xy]/g, (char) => {
        const random = Math.floor(Math.random() * 16)
        const value = char === 'x' ? random : (random & 0x3) | 0x8
        return value.toString(16)
    })
}

const getCurrentTaroPages = (taro?: TaroWithRouteEvents): TaroPage[] => {
    try {
        if (typeof taro?.getCurrentPages === 'function') {
            return taro.getCurrentPages() as TaroPage[]
        }
        return typeof getCurrentPages === 'function' ? getCurrentPages() : []
    } catch {
        return []
    }
}

const normalizeRoute = (route?: PageviewRoute, taro?: TaroWithRouteEvents): PageviewRoute => {
    if (route?.path || route?.route) {
        return route
    }

    const pages = getCurrentTaroPages(taro)
    const currentPage: TaroPage | undefined = pages[pages.length - 1]
    const path = currentPage?.route || currentPage?.path || currentPage?.$taroPath

    return {
        path,
        route: path,
        query: currentPage?.options,
    }
}

const getString = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

const getNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)

export class PostHogMiniProgram {
    private readonly apiKey: string
    private readonly host: string
    private readonly flushAt: number
    private readonly flushInterval: number
    private readonly requestTimeout: number
    private readonly storageKey: string
    private readonly options: PostHogMiniProgramOptions
    private state: PersistedState = {}
    private flushTimer?: ReturnType<typeof setTimeout>
    private flushPromise?: Promise<void>
    private lastPagePath?: string
    private systemInfoProperties?: Properties
    private disabled = false
    private appRouteHandler?: (route: PageviewRoute) => void
    private appHideHandler?: () => void

    constructor(apiKey: string, options: PostHogMiniProgramOptions = {}) {
        this.apiKey = (apiKey || '').trim()
        this.options = options
        this.host = trimTrailingSlash(options.api_host || DEFAULT_HOST)
        this.flushAt = options.flush_at ?? DEFAULT_FLUSH_AT
        this.flushInterval = options.flush_interval ?? DEFAULT_FLUSH_INTERVAL
        this.requestTimeout = options.request_timeout ?? DEFAULT_REQUEST_TIMEOUT
        this.storageKey = `ph_${options.persistence_name || this.apiKey}_miniprogram`
        this.disabled = !this.apiKey

        this.state = this.readState()
        this.setupIdentity()
        this.persistState()

        if (options.capture_pageview !== false) {
            this.installPageviewTracking()
        }

        this.appHideHandler = () => {
            void this.flush().catch(() => undefined)
        }
        taro.onAppHide?.(this.appHideHandler)

        options.loaded?.(this)
    }

    capture(event: string, properties: Properties = {}, options: CaptureOptions = {}): CaptureResult | undefined {
        if (this.disabled || !event) {
            return
        }

        const eventPayload: CaptureResult = {
            event,
            properties: {
                ...(this.state.super_properties || {}),
                ...this.getSystemInfoProperties(),
                ...properties,
                distinct_id: this.getDistinctId(),
                $device_id: this.getDeviceId(),
                $lib: LIBRARY,
                $lib_version: version,
                ...((options.disable_geoip ?? this.options.disable_geoip) ? { $geoip_disable: true } : {}),
            },
            distinct_id: this.getDistinctId(),
            timestamp: this.normalizeTimestamp(options.timestamp),
            uuid: options.uuid || createUuid(),
            type: 'capture',
            library: LIBRARY,
            library_version: version,
        }

        const preparedEvent = this.options.before_send ? this.options.before_send(eventPayload) : eventPayload
        if (!preparedEvent) {
            return
        }

        this.enqueue(preparedEvent)

        if (options.send_instantly || this.getQueue().length >= this.flushAt) {
            void this.flush().catch((error) => this.log('flush failed', error))
        } else {
            this.scheduleFlush()
        }

        return preparedEvent
    }

    capturePageview(route?: PageviewRoute, properties: Properties = {}): CaptureResult | undefined {
        return this.captureScreen(route, properties)
    }

    captureScreen(route?: PageviewRoute, properties: Properties = {}): CaptureResult | undefined {
        const normalizedRoute = normalizeRoute(route, taro)
        const path = normalizedRoute.path || normalizedRoute.route || ''
        const query = stringifyQuery(normalizedRoute.query)
        const currentUrl = `${path}${query}`

        if (currentUrl && currentUrl === this.lastPagePath) {
            return
        }

        const pageviewProperties: Properties = {
            $current_url: currentUrl,
            $pathname: path,
            $referrer: '$direct',
            $screen_name: currentUrl || path,
            taro_open_type: normalizedRoute.openType,
            ...(this.options.get_pageview_properties?.(normalizedRoute) || {}),
            ...properties,
        }

        this.lastPagePath = currentUrl
        return this.capture('$screen', pageviewProperties)
    }

    identify(distinctId: string, userPropertiesToSet?: Properties, userPropertiesToSetOnce?: Properties): void {
        if (!distinctId) {
            return
        }

        const previousDistinctId = this.getDistinctId()
        this.state.distinct_id = distinctId
        this.persistState()

        if (previousDistinctId !== distinctId) {
            this.capture('$identify', {
                distinct_id: distinctId,
                $anon_distinct_id: previousDistinctId,
                $set: userPropertiesToSet,
                $set_once: userPropertiesToSetOnce,
            })
        }
    }

    alias(alias: string, distinctId: string = this.getDistinctId()): void {
        if (!alias) {
            return
        }

        this.capture('$create_alias', {
            alias,
            distinct_id: distinctId,
        })
    }

    register(properties: Properties): void {
        this.state.super_properties = {
            ...(this.state.super_properties || {}),
            ...properties,
        }
        this.persistState()
    }

    unregister(property: string): void {
        if (!this.state.super_properties) {
            return
        }

        delete this.state.super_properties[property]
        this.persistState()
    }

    reset(): void {
        const queue = this.getQueue()
        const anonymousId = createUuid()
        this.state = {
            anonymous_id: anonymousId,
            distinct_id: anonymousId,
            device_id: anonymousId,
            queue,
        }
        this.persistState()
    }

    getDistinctId(): string {
        return this.state.distinct_id || this.state.anonymous_id || ''
    }

    getDeviceId(): string {
        return this.state.device_id || this.getDistinctId()
    }

    installPageviewTracking(options: PageviewTrackingOptions = {}): void {
        if (options.capture_initial !== false) {
            setTimeout(() => this.captureScreen(), 0)
        }

        if (!taro.onAppRoute || this.appRouteHandler) {
            return
        }

        this.appRouteHandler = (route: PageviewRoute) => {
            this.captureScreen(route)
        }
        taro.onAppRoute(this.appRouteHandler)
    }

    async flush(): Promise<void> {
        if (this.disabled) {
            return
        }

        if (this.flushPromise) {
            return this.flushPromise
        }

        this.clearFlushTimer()
        this.flushPromise = this.flushQueue().finally(() => {
            this.flushPromise = undefined
        })

        return this.flushPromise
    }

    stop(): void {
        this.clearFlushTimer()

        if (this.appRouteHandler) {
            taro.offAppRoute?.(this.appRouteHandler)
            this.appRouteHandler = undefined
        }

        if (this.appHideHandler) {
            taro.offAppHide?.(this.appHideHandler)
            this.appHideHandler = undefined
        }
    }

    private setupIdentity(): void {
        if (this.state.distinct_id) {
            return
        }

        const bootstrapDistinctId = this.options.bootstrap?.distinctID
        const anonymousId =
            bootstrapDistinctId && !this.options.bootstrap?.isIdentifiedID ? bootstrapDistinctId : createUuid()

        this.state.anonymous_id = this.state.anonymous_id || anonymousId
        this.state.device_id = this.state.device_id || this.state.anonymous_id
        this.state.distinct_id = bootstrapDistinctId || this.state.anonymous_id
    }

    private normalizeTimestamp(timestamp?: Date | string): string {
        if (timestamp instanceof Date) {
            return timestamp.toISOString()
        }

        return timestamp || now()
    }

    private getSystemInfoProperties(): Properties {
        if (this.systemInfoProperties) {
            return this.systemInfoProperties
        }

        let systemInfo: Record<string, unknown> = {}
        try {
            systemInfo = (taro.getSystemInfoSync?.() || {}) as unknown as Record<string, unknown>
        } catch {
            systemInfo = {}
        }

        this.systemInfoProperties = {
            $screen_height: getNumber(systemInfo.screenHeight),
            $screen_width: getNumber(systemInfo.screenWidth),
            $viewport_height: getNumber(systemInfo.windowHeight),
            $viewport_width: getNumber(systemInfo.windowWidth),
            $device_model: getString(systemInfo.model),
            $device_manufacturer: getString(systemInfo.brand),
            $os: getString(systemInfo.platform),
            $os_version: getString(systemInfo.system),
            taro_pixel_ratio: getNumber(systemInfo.pixelRatio),
            taro_sdk_version: getString(systemInfo.SDKVersion),
            taro_language: getString(systemInfo.language),
            taro_theme: getString(systemInfo.theme),
        }

        return this.systemInfoProperties
    }

    private enqueue(event: CaptureResult): void {
        this.state.queue = [...this.getQueue(), event]
        this.persistState()
        this.log('queued event', event)
    }

    private getQueue(): CaptureResult[] {
        return this.state.queue || []
    }

    private scheduleFlush(): void {
        if (this.flushTimer || this.flushInterval <= 0) {
            return
        }

        this.flushTimer = setTimeout(() => {
            void this.flush().catch((error) => this.log('flush failed', error))
        }, this.flushInterval)
    }

    private clearFlushTimer(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = undefined
        }
    }

    private async flushQueue(): Promise<void> {
        while (this.getQueue().length > 0) {
            const batch = this.getQueue().slice(0, this.flushAt)

            await this.sendBatch(batch)

            this.state.queue = this.getQueue().slice(batch.length)
            this.persistState()
        }
    }

    private sendBatch(batch: CaptureResult[]): Promise<void> {
        return new Promise((resolve, reject) => {
            taro.request({
                url: `${this.host}/batch/`,
                method: 'POST',
                data: {
                    api_key: this.apiKey,
                    batch,
                    sent_at: now(),
                },
                header: {
                    'Content-Type': 'application/json',
                },
                timeout: this.requestTimeout,
                success: (result) => {
                    if (result.statusCode >= 200 && result.statusCode < 300) {
                        resolve()
                    } else {
                        reject(new Error(`PostHog request failed with status ${result.statusCode}`))
                    }
                },
                fail: reject,
            })
        })
    }

    private readState(): PersistedState {
        try {
            const value = taro.getStorageSync?.(this.storageKey)
            if (typeof value === 'string') {
                const parsed: unknown = JSON.parse(value)
                return isRecord(parsed) ? (parsed as PersistedState) : {}
            }

            return isRecord(value) ? (value as PersistedState) : {}
        } catch {
            return {}
        }
    }

    private persistState(): void {
        try {
            taro.setStorageSync?.(this.storageKey, JSON.stringify(this.state))
        } catch {
            return
        }
    }

    private log(message: string, payload?: unknown): void {
        if (this.options.debug) {
            console.log(`[PostHog MiniProgram] ${message}`, payload)
        }
    }
}

export const init = (apiKey: string, options?: PostHogMiniProgramOptions): PostHogMiniProgram => {
    return new PostHogMiniProgram(apiKey, options)
}

export default PostHogMiniProgram
