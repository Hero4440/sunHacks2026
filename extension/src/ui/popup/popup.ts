// Popup Script - Handles popup UI interactions

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners()
  updateUI()
})

function setupEventListeners(): void {
  // Open Command Palette
  const openPaletteBtn = document.getElementById('open-command-palette')
  if (openPaletteBtn) {
    openPaletteBtn.addEventListener('click', async () => {
      await openCommandPalette()
      window.close()
    })
  }

  // Spotlight Search
  const spotlightBtn = document.getElementById('spotlight-search')
  if (spotlightBtn) {
    spotlightBtn.addEventListener('click', async () => {
      await openCommandPalette()
      window.close()
    })
  }

  // Take Screenshot
  const screenshotBtn = document.getElementById('take-screenshot')
  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', async () => {
      await takeScreenshot()
      window.close()
    })
  }

  // Open Settings
  const settingsBtn = document.getElementById('open-settings')
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      await chrome.runtime.openOptionsPage()
      window.close()
    })
  }
}

async function openCommandPalette(): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (activeTab?.id) {
      await chrome.tabs.sendMessage(activeTab.id, {
        type: 'OPEN_COMMAND_PALETTE',
        timestamp: Date.now()
      })
    }
  } catch (error) {
    console.error('Error opening command palette:', error)
    // Fallback: show notification
    showNotification('Command palette not available on this page', 'error')
  }
}

async function takeScreenshot(): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (activeTab?.id) {
      await chrome.tabs.sendMessage(activeTab.id, {
        type: 'TAKE_SCREENSHOT',
        mode: 'visible',
        timestamp: Date.now()
      })
    }
  } catch (error) {
    console.error('Error taking screenshot:', error)
    showNotification('Screenshot not available on this page', 'error')
  }
}

async function updateUI(): Promise<void> {
  try {
    // Get current tab info
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })

    // Check if we can inject into this tab
    const canInject = activeTab?.url &&
      !activeTab.url.startsWith('chrome://') &&
      !activeTab.url.startsWith('chrome-extension://') &&
      !activeTab.url.startsWith('moz-extension://')

    // Disable buttons if we can't inject
    const buttons = document.querySelectorAll('.action-button')
    buttons.forEach(button => {
      if (!canInject) {
        button.classList.add('disabled')
        button.setAttribute('title', 'Not available on this page')
      }
    })

  } catch (error) {
    console.error('Error updating UI:', error)
  }
}

function showNotification(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
  // This would show a toast notification
  console.log(`${type.toUpperCase()}: ${message}`)
}