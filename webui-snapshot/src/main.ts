// Svelte 5 runes entry: mounts App + registers the PWA service worker.
import { registerSW } from 'virtual:pwa-register'
import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'

// PWA: activate the workbox SW immediately (autoUpdate keeps it fresh).
registerSW({ immediate: true })

const target = document.getElementById('app')
if (!target) throw new Error('#app element not found')
mount(App, { target })
// Remove the pre-boot splash (index.html) once Svelte has mounted.
document.getElementById('agent-splash')?.remove()
