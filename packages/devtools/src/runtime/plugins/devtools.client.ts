import { createApp, h, markRaw, ref, shallowReactive, toRaw, watch, watchEffect } from 'vue'

import { setupHooksDebug } from '../shared/hooks'
import type { LoadingTimeMetric, NuxtDevtoolsHostClient, PluginMetric, VueInspectorClient } from '../../types'
import '../shared/client.d'

import { useClientColorMode } from './view/client'

// eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
// @ts-ignore tsconfig
import { CLIENT_PATH } from './view/constants'
import { defineNuxtPlugin, useAppConfig, useRouter, useState } from '#imports'

export default defineNuxtPlugin((nuxt: any) => {
  // TODO: Stackblitz support?
  if (typeof document === 'undefined' || typeof window === 'undefined')
    return

  if (window.parent && window.self !== window.parent) {
    try {
      if (window.parent.__NUXT_DEVTOOLS_VIEW__ || window.parent.document.querySelector('#nuxt-devtools-container'))
        return
    }
    catch (e) {
      // Cross-origin
      return
    }
  }

  window.__NUXT_DEVTOOLS_URL__ = window.location.origin + CLIENT_PATH

  const timeMetric = window.__NUXT_DEVTOOLS_TIME_METRIC__ = shallowReactive(window.__NUXT_DEVTOOLS_TIME_METRIC__ || {})
  timeMetric.pluginInit = Date.now()

  const clientHooks = setupHooksDebug(nuxt.hooks)
  const router = useRouter()

  nuxt.hook('app:mounted', () => {
    timeMetric.appLoad = Date.now()
  })
  router.beforeEach(() => {
    timeMetric.pageStart = Date.now()
  })
  nuxt.hook('page:finish', () => {
    timeMetric.pageEnd = Date.now()
  })

  const ssrState = useState('__nuxt_devtools__', () => ({}))

  watchEffect(() => {
    if (ssrState.value.timeSsrStart)
      timeMetric.ssrStart = ssrState.value.timeSsrStart
  })

  async function init() {
    const { closePanel, togglePanel } = await import('./view/state')
    const { createHooks } = await import('hookable')
    const { default: Main } = await import('./view/Main.vue')

    const isInspecting = ref(false)
    const colorMode = useClientColorMode()
    const client: NuxtDevtoolsHostClient = shallowReactive({
      nuxt: markRaw(nuxt as any),
      hooks: createHooks(),
      appConfig: useAppConfig() as any,
      getClientHooksMetrics: () => Object.values(clientHooks),
      getClientPluginMetrics: () => {
        return window.__NUXT_DEVTOOLS_PLUGINS_METRIC__ || []
      },
      loadingTimeMetrics: timeMetric,
      reloadPage() {
        location.reload()
      },
      closeDevTools: closePanel,
      inspector: getInspectorInstance(),
      colorMode,
      refreshState(iframe?: HTMLIFrameElement): NuxtDevtoolsHostClient {
        if (!client.inspector)
          client.inspector = getInspectorInstance()

        window.__NUXT_DEVTOOLS_HOST_CLIENT__ = toRaw(client)
        try {
          iframe?.contentWindow?.__NUXT_DEVTOOLS_VIEW__?.setClient(client)
        }
        catch (e) {}

        return client
      },
    })

    function refreshReactivity() {
      client.hooks.callHook('host:update:reactivity')
    }

    watch(() => [
      client.nuxt.payload,
      client.colorMode.value,
      client.loadingTimeMetrics,
    ], () => {
      refreshReactivity()
    }, { deep: true })
    // trigger update for route change
    client.nuxt.vueApp.config.globalProperties?.$router?.afterEach(() => {
      refreshReactivity()
    })
    // trigger update for app mounted
    client.nuxt.hook('app:mounted', () => {
      refreshReactivity()
    })

    client.refreshState()

    function enableComponentInspector() {
      window.__VUE_INSPECTOR__?.enable()
      isInspecting.value = true
    }

    function disableComponentInspector() {
      if (!window.__VUE_INSPECTOR__?.enabled)
        return

      window.__VUE_INSPECTOR__?.disable()
      client?.hooks.callHook('host:inspector:close')
      isInspecting.value = false
    }

    function getInspectorInstance(): NuxtDevtoolsHostClient['inspector'] {
      const componentInspector = window.__VUE_INSPECTOR__ as VueInspectorClient

      if (componentInspector) {
        componentInspector.openInEditor = async (baseUrl, file, line, column) => {
          disableComponentInspector()
          await client.hooks.callHook('host:inspector:click', baseUrl, file, line, column)
        }
        componentInspector.onUpdated = () => {
          client.hooks.callHook('host:inspector:update', {
            ...componentInspector.linkParams,
            ...componentInspector.position,
          })
        }
      }

      return markRaw({
        isEnabled: isInspecting,
        enable: enableComponentInspector,
        disable: disableComponentInspector,
        toggle: () => {
          if (window.__VUE_INSPECTOR__?.enabled)
            disableComponentInspector()
          else
            enableComponentInspector()
        },
        instance: componentInspector,
      })
    }

    const holder = document.createElement('div')
    holder.id = 'nuxt-devtools-container'
    holder.setAttribute('data-v-inspector-ignore', 'true')
    document.body.appendChild(holder)

    // Shortcut to toggle devtools
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyD' && e.altKey && e.shiftKey)
        togglePanel()
    })

    const app = createApp({
      render: () => h(Main, { client }),
      devtools: {
        hide: true,
      },
    })
    app.mount(holder)
  }

  setTimeout(init, 1)
})

declare global {
  interface Window {
    __NUXT_DEVTOOLS_PLUGINS_METRIC__?: PluginMetric[]
    __NUXT_DEVTOOLS_TIME_METRIC__?: LoadingTimeMetric
    __VUE_INSPECTOR__?: VueInspectorClient
  }
}
