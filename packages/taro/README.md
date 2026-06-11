# PostHog Mini Program

Minimal PostHog client for Taro mini apps.

This package is intentionally separate from `posthog-js`. It avoids browser-only APIs such as `window`, `document`, `history`, `fetch`, cookies, `localStorage`, Session Replay, autocapture, surveys, feature flags, and exception autocapture. It keeps only the basics needed to send events from a Taro mini app.

## Install

```bash
pnpm add @posthog/miniprogram
```

## Usage

Initialize once in your Taro app, usually in `app.ts` or `app.js`:

```ts
import PostHog from '@posthog/miniprogram'

export const posthog = new PostHog('YOUR_PROJECT_API_KEY', {
    api_host: 'https://us.i.posthog.com',
    capture_pageview: true,
})
```

Capture custom events:

```ts
posthog.capture('checkout started', {
    product_id: 'sku_123',
})
```

Identify a user after login:

```ts
posthog.identify('user_123', {
    plan: 'pro',
})
```

## Screen Views

When available, the SDK uses `Taro.onAppRoute` to capture `$screen` events and `Taro.getCurrentPages()` to populate route information. It also captures the initial screen after initialization.

If your Taro runtime does not expose `onAppRoute`, call `captureScreen` from page lifecycle handlers:

```ts
Page({
    onShow() {
        posthog.captureScreen()
    },
})
```

## API

- `capture(event, properties?, options?)`
- `captureScreen(route?, properties?)`
- `capturePageview(route?, properties?)`
- `identify(distinctId, userPropertiesToSet?, userPropertiesToSetOnce?)`
- `alias(alias, distinctId?)`
- `register(properties)`
- `unregister(property)`
- `reset()`
- `flush()`
- `stop()`

Events are persisted with `Taro.setStorageSync` and sent to PostHog with `Taro.request` at `/batch/`.

The SDK also adds basic app context from `Taro.getSystemInfoSync()`, including screen size, viewport size, device model, manufacturer, OS, pixel ratio, SDK version, language, and theme.
