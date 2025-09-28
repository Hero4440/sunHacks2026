// Sidebar Script - Handles sidebar UI interactions and communication

let currentSettings: any = {}
let lastPayload: any = null

document.addEventListener('DOMContentLoaded', () => {
  setupTabSwitching()
  setupSettings()
  loadInitialData()
})

function setupTabSwitching(): void {
  const tabs = document.querySelectorAll('.tab')
  const panels = document.querySelectorAll('.tab-panel')

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab')

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'))
      tab.classList.add('active')

      // Update active panel
      panels.forEach(panel => {
        panel.classList.remove('active')
        if (panel.id === `${targetTab}-panel`) {
          panel.classList.add('active')
          if (targetTab === 'sent') {
            updateSentPanel()
          }
        }
      })
    })
  })
}

function setupSettings(): void {
  // Setup toggle switches
  const toggles = document.querySelectorAll('.toggle')
  toggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active')
      handleSettingChange(toggle)
    })
  })

  // Setup numeric inputs
  const tokenCapInput = document.getElementById('token-cap-input') as HTMLInputElement
  if (tokenCapInput) {
    tokenCapInput.addEventListener('change', () => handleNumericSettingChange('tokenCapPerDay', tokenCapInput))
  }

  const cacheTtlInput = document.getElementById('cache-ttl-input') as HTMLInputElement
  if (cacheTtlInput) {
    cacheTtlInput.addEventListener('change', () => handleNumericSettingChange('cacheTTL', cacheTtlInput))
  }

  // Setup buttons
  const forgetAllBtn = document.getElementById('forget-all-btn')
  if (forgetAllBtn) {
    forgetAllBtn.addEventListener('click', handleForgetAll)
  }

  const exportBtn = document.getElementById('export-settings-btn')
  if (exportBtn) {
    exportBtn.addEventListener('click', handleExportSettings)
  }

  const importBtn = document.getElementById('import-settings-btn')
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      const fileInput = document.getElementById('import-settings-input') as HTMLInputElement
      fileInput?.click()
    })
  }

  const importInput = document.getElementById('import-settings-input') as HTMLInputElement
  if (importInput) {
    importInput.addEventListener('change', handleImportSettings)
  }
}

async function loadInitialData(): Promise<void> {
  try {
    // Load settings from background
    const response = await chrome.runtime.sendMessage({
      type: 'GET_SETTINGS',
      timestamp: Date.now()
    })

    if (response.success) {
      currentSettings = response.data
      updateSettingsUI()
    }
  } catch (error) {
    console.error('Error loading settings:', error)
  }
}

function updateSettingsUI(): void {
  // Update toggle states based on current settings
  const safeModeToggle = document.getElementById('safe-mode-toggle')
  if (safeModeToggle) {
    if (currentSettings.safeMode) {
      safeModeToggle.classList.add('active')
    } else {
      safeModeToggle.classList.remove('active')
    }
  }

  const proactiveToggle = document.getElementById('proactive-toggle')
  if (proactiveToggle) {
    if (currentSettings.proactiveChips) {
      proactiveToggle.classList.add('active')
    } else {
      proactiveToggle.classList.remove('active')
    }
  }

  const redactionToggle = document.getElementById('redaction-toggle')
  if (redactionToggle) {
    if (currentSettings.screenshotRedaction) {
      redactionToggle.classList.add('active')
    } else {
      redactionToggle.classList.remove('active')
    }
  }

  const recallToggle = document.getElementById('recall-toggle')
  if (recallToggle) {
    if (currentSettings.recallEnabled) {
      recallToggle.classList.add('active')
    } else {
      recallToggle.classList.remove('active')
    }
  }

  // Update numeric inputs
  const tokenCapInput = document.getElementById('token-cap-input') as HTMLInputElement
  if (tokenCapInput) {
    tokenCapInput.value = currentSettings.tokenCapPerDay?.toString() || '10000'
  }

  const cacheTtlInput = document.getElementById('cache-ttl-input') as HTMLInputElement
  if (cacheTtlInput) {
    cacheTtlInput.value = currentSettings.cacheTTL?.toString() || '180'
  }

  // Check if current site is allowed
  updateSiteAllowToggle()
}

async function updateSiteAllowToggle(): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (activeTab?.url) {
      const hostname = new URL(activeTab.url).hostname
      const isAllowed = currentSettings.allowedSites?.includes(hostname)

      const siteToggle = document.getElementById('site-allow-toggle')
      if (siteToggle) {
        if (isAllowed) {
          siteToggle.classList.add('active')
        } else {
          siteToggle.classList.remove('active')
        }
      }
    }
  } catch (error) {
    console.error('Error updating site allow toggle:', error)
  }
}

async function handleSettingChange(toggle: Element): Promise<void> {
  const isActive = toggle.classList.contains('active')
  const settingId = toggle.id

  try {
    let settingUpdate: any = {}

    switch (settingId) {
      case 'safe-mode-toggle':
        settingUpdate.safeMode = isActive
        break
      case 'proactive-toggle':
        settingUpdate.proactiveChips = isActive
        break
      case 'redaction-toggle':
        settingUpdate.screenshotRedaction = isActive
        break
      case 'recall-toggle':
        settingUpdate.recallEnabled = isActive
        if (isActive) {
          // Request permissions when enabling recall
          const response = await chrome.runtime.sendMessage({
            type: 'ENABLE_RECALL',
            timestamp: Date.now()
          })
          if (!response.success) {
            // Revert toggle if permission was denied
            toggle.classList.remove('active')
            currentSettings.recallEnabled = false
            showMessage('History permission required for recall', 'error')
            return
          }
        }
        break
      case 'site-allow-toggle':
        await handleSiteAllowChange(isActive)
        return
      default:
        return
    }

    // Send update to background
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: settingUpdate,
      timestamp: Date.now()
    })

    // Update local settings
    currentSettings = { ...currentSettings, ...settingUpdate }

  } catch (error) {
    console.error('Error updating setting:', error)
    // Revert toggle state on error
    toggle.classList.toggle('active')
  }
}

async function handleSiteAllowChange(isAllowed: boolean): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!activeTab?.url) return

    const hostname = new URL(activeTab.url).hostname
    const allowedSites = [...(currentSettings.allowedSites || [])]
    const deniedSites = [...(currentSettings.deniedSites || [])]

    if (isAllowed) {
      // Add to allowed, remove from denied
      if (!allowedSites.includes(hostname)) {
        allowedSites.push(hostname)
      }
      const deniedIndex = deniedSites.indexOf(hostname)
      if (deniedIndex > -1) {
        deniedSites.splice(deniedIndex, 1)
      }
    } else {
      // Add to denied, remove from allowed
      if (!deniedSites.includes(hostname)) {
        deniedSites.push(hostname)
      }
      const allowedIndex = allowedSites.indexOf(hostname)
      if (allowedIndex > -1) {
        allowedSites.splice(allowedIndex, 1)
      }
    }

    // Send update to background
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: { allowedSites, deniedSites },
      timestamp: Date.now()
    })

    // Update local settings
    currentSettings.allowedSites = allowedSites
    currentSettings.deniedSites = deniedSites

  } catch (error) {
    console.error('Error updating site allow setting:', error)
  }
}

async function handleForgetAll(): Promise<void> {
  if (!confirm('This will delete all local data including timeline, topic tags, and cached summaries. Continue?')) {
    return
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'FORGET_ALL_DATA',
      timestamp: Date.now()
    })

    // Show success message
    showMessage('All data has been forgotten', 'success')

  } catch (error) {
    console.error('Error forgetting all data:', error)
    showMessage('Error forgetting data', 'error')
  }
}

function showMessage(text: string, type: 'success' | 'error' = 'success'): void {
  // Create a simple toast notification
  const toast = document.createElement('div')
  toast.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    background: ${type === 'success' ? '#10b981' : '#ef4444'};
    color: white;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `
  toast.textContent = text

  document.body.appendChild(toast)

  setTimeout(() => {
    toast.remove()
  }, 3000)
}

// Listen for messages from background/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'UPDATE_ANSWERS':
      updateAnswersPanel(message.payload)
      break
    case 'UPDATE_STEPS':
      updateStepsPanel(message.payload)
      break
    case 'SETTINGS_CHANGED':
      currentSettings = message.payload
      updateSettingsUI()
      break
    case 'WORKER_PAYLOAD':
      lastPayload = message.payload
      updateSentPanel()
      break
  }
})

function updateAnswersPanel(data: any): void {
  const panel = document.getElementById('answers-panel')
  if (!panel) return

  panel.innerHTML = `
    <div class="answer-section">
      <div class="answer-title">AI Response</div>
      <div class="answer-content">${data.answer || 'No response available'}</div>
    </div>
  `
}

function describeAction(step: any): string {
  if (!step) return ''
  const act = step.act || step.action?.act
  const target = step.target || step.action?.target
  const to = step.to || step.action?.to
  const text = step.text || step.action?.text
  const confirm = step.confirm || step.action?.confirm
  const waitMs = step.waitMs || step.action?.waitMs

  const truncate = (value: string, length = 32) => (
    value.length <= length ? value : `${value.slice(0, length - 1)}…`
  )

  switch (act) {
    case 'find':
      return target ? `Find “${target}”` : 'Find element'
    case 'scroll': {
      const destination = to ?? 'center'
      return target ? `Scroll to “${target}” (${destination})` : `Scroll to ${destination}`
    }
    case 'focus':
      return target ? `Focus “${target}”` : 'Focus element'
    case 'type': {
      const preview = text ? truncate(text) : 'text'
      return target ? `Type “${preview}” in “${target}”` : `Type “${preview}”`
    }
    case 'click': {
      const label = target ? `“${target}”` : 'element'
      return confirm ? `Confirm click on ${label}` : `Click ${label}`
    }
    case 'tab':
      return 'Press Tab'
    case 'wait':
      return `Wait ${waitMs ?? 0}ms`
    default:
      return act || 'Step'
  }
}

function updateStepsPanel(steps: any[]): void {
  const panel = document.getElementById('steps-panel')
  if (!panel) return

  if (!steps || steps.length === 0) {
    panel.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
        </svg>
        <p>No action plan yet. Try asking me to help with a task!</p>
      </div>
    `
    return
  }

  const stepsHtml = steps.map((step: any, index: number) => {
    const status: string = step.status
      ? String(step.status)
      : step.completed
        ? 'success'
        : step.failed
          ? 'failed'
          : 'pending'

    const statusClass = status === 'success' ? 'completed' : status === 'failed' ? 'failed' : ''
    const icon = status === 'success' ? '✓' : status === 'failed' ? '✗' : (index + 1).toString()
    const label = step.label || describeAction(step.action ?? step)
    const detail = step.message ? `<div class="action-detail">${escapeHtml(step.message)}</div>` : ''

    return `
      <div class="action-item ${statusClass}">
        <span class="action-icon">${icon}</span>
        <span>${escapeHtml(label)}</span>
        ${detail}
      </div>
    `
  }).join('')

  panel.innerHTML = `
    <div class="action-plan">
      <div class="answer-title">Action Plan</div>
      ${stepsHtml}
    </div>
  `
}

async function handleNumericSettingChange(settingKey: string, input: HTMLInputElement): Promise<void> {
  try {
    const value = parseInt(input.value, 10)
    if (isNaN(value) || value < 0) {
      // Revert to current setting
      input.value = currentSettings[settingKey]?.toString() || '0'
      showMessage('Invalid value entered', 'error')
      return
    }

    const settingUpdate = { [settingKey]: value }

    // Send update to background
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: settingUpdate,
      timestamp: Date.now()
    })

    // Update local settings
    currentSettings = { ...currentSettings, ...settingUpdate }
    showMessage('Setting updated', 'success')

  } catch (error) {
    console.error('Error updating numeric setting:', error)
    // Revert input value
    input.value = currentSettings[settingKey]?.toString() || '0'
    showMessage('Error updating setting', 'error')
  }
}

async function handleExportSettings(): Promise<void> {
  try {
    const settings = { ...currentSettings }

    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: 'application/json'
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nebula-settings-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    showMessage('Settings exported', 'success')
  } catch (error) {
    console.error('Error exporting settings:', error)
    showMessage('Error exporting settings', 'error')
  }
}

async function handleImportSettings(event: Event): Promise<void> {
  try {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]

    if (!file) return

    const text = await file.text()
    const importedSettings = JSON.parse(text)

    // Validate imported settings
    if (typeof importedSettings !== 'object' || importedSettings === null) {
      throw new Error('Invalid settings file format')
    }

    // Merge with current settings, preserving site permissions
    const mergedSettings = {
      ...currentSettings,
      ...importedSettings,
      allowedSites: importedSettings.allowedSites ?? currentSettings.allowedSites ?? [],
      deniedSites: importedSettings.deniedSites ?? currentSettings.deniedSites ?? []
    }

    // Send update to background
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: mergedSettings,
      timestamp: Date.now()
    })

    // Update local settings and UI
    currentSettings = mergedSettings
    updateSettingsUI()

    showMessage('Settings imported', 'success')

    // Clear the file input
    input.value = ''

  } catch (error) {
    console.error('Error importing settings:', error)
    showMessage('Error importing settings - invalid file format', 'error')
  }
}

function updateSentPanel(): void {
  const panel = document.getElementById('sent-panel-content')
  if (!panel) return

  if (!lastPayload) {
    panel.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <p>No requests yet. Ask Nebula something to view the payload.</p>
      </div>
    `
    return
  }

  const { request, response, latencyMs, timestamp } = lastPayload
  const plan = lastPayload.plan
  const planExecution = lastPayload.planExecution
  const bundle = request?.bundle || {}
  const tokens = response?.tokens || {}
  const timestampStr = timestamp ? new Date(timestamp).toLocaleTimeString() : 'now'

  const headings = (bundle.headings || [])
    .map((heading: string) => `<li>${heading}</li>`)
    .join('')

  const timeline = (bundle.timeline || [])
    .map((item: any) => `<li><strong>${item.title}</strong> – ${item.url}</li>`)
    .join('')

  const payloadPreview = response?.payloadPreview
    ? `<pre class="sent-json">${escapeHtml(JSON.stringify(response.payloadPreview, null, 2))}</pre>`
    : ''

  const planList = Array.isArray(plan?.steps)
    ? plan.steps.map((step: any, index: number) => {
        const executionStep = planExecution?.steps?.[index]
        const status = executionStep?.status ?? 'pending'
        const badge = status === 'success' ? '✓' : status === 'failed' ? '✗' : String(index + 1)
        const message = executionStep?.message ? `<div class="sent-plan-note">${escapeHtml(executionStep.message)}</div>` : ''
        return `
          <li class="sent-plan-item sent-plan-${status}">
            <span class="sent-plan-badge">${badge}</span>
            <span>${escapeHtml(describeAction(step))}</span>
            ${message}
          </li>
        `
      }).join('')
    : ''

  const planMetaParts: string[] = []
  if (plan?.model) planMetaParts.push(`Model: ${plan.model}`)
  if (plan?.source) planMetaParts.push(`Source: ${plan.source}`)
  if (plan?.cached) planMetaParts.push('Cached')
  if (plan?.requestId) planMetaParts.push(`Request: ${plan.requestId}`)
  if (planExecution?.durationMs !== undefined) planMetaParts.push(`Duration: ${Math.round(planExecution.durationMs)}ms`)

  const planMeta = planMetaParts.length
    ? `<div class="sent-plan-meta">${planMetaParts.map(part => `<span>${escapeHtml(part)}</span>`).join(' • ')}</div>`
    : ''

  panel.innerHTML = `
    <div class="sent-section">
      <div class="sent-label">Request</div>
      <div class="sent-grid">
        <div><strong>Query</strong><br/>${escapeHtml(request?.query || '')}</div>
        <div><strong>Tokens Used</strong><br/>${bundle.tokenCount ?? 0}</div>
        <div><strong>Token Base</strong><br/>${bundle.baseTokens ?? 0}</div>
        <div><strong>Latency</strong><br/>${latencyMs ?? '—'} ms</div>
        <div><strong>Timestamp</strong><br/>${timestampStr}</div>
      </div>
      ${bundle.selection ? `<div><strong>Selection</strong><br/>${escapeHtml(bundle.selection)}</div>` : ''}
      ${headings ? `<div><strong>Headings</strong><ul class="sent-list">${headings}</ul></div>` : ''}
      ${timeline ? `<div><strong>Timeline</strong><ul class="sent-list">${timeline}</ul></div>` : ''}
    </div>
    <div class="sent-section">
      <div class="sent-label">Response</div>
      <div class="sent-grid">
        <div><strong>Model</strong><br/>${escapeHtml(response?.model || '—')}</div>
        <div><strong>Source</strong><br/>${escapeHtml(response?.source || '—')}</div>
        <div><strong>Output Tokens</strong><br/>${tokens.out ?? 0}</div>
        <div><strong>Input Tokens</strong><br/>${(tokens.in ?? bundle.tokenCount ?? 0)}</div>
        <div><strong>Cached</strong><br/>${response?.cached ? 'Yes' : 'No'}</div>
        <div><strong>Request ID</strong><br/>${escapeHtml(response?.requestId || '—')}</div>
      </div>
      ${payloadPreview}
      ${Array.isArray(response?.citations) && response.citations.length ? `
        <div><strong>Citations</strong>
          <ul class="sent-list">
            ${response.citations.map((item: any) => `<li>${escapeHtml(item.title || item.url || '')}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
    ${planList ? `
      <div class="sent-section">
        <div class="sent-label">Action Plan</div>
        <ul class="sent-plan-list">${planList}</ul>
        ${planMeta}
      </div>
    ` : ''}
  `
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char] as string))
}
