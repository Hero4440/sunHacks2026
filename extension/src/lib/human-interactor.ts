// Human Interactor - Simulates realistic human interactions
// Types, clicks, scrolls with natural timing and React/Vue compatibility

import { ElementResolver, ElementMatch } from './element-resolver'

export interface Action {
  act: 'find' | 'scroll' | 'focus' | 'type' | 'click' | 'tab' | 'wait'
  target?: string
  text?: string
  to?: 'center' | 'top' | 'bottom'
  perChar?: boolean
  confirm?: boolean
  timeout?: number
}

export interface ActionResult {
  success: boolean
  message: string
  element?: HTMLElement
  error?: string
}

export class HumanInteractor {
  private elementResolver: ElementResolver
  private lastFocusedElement: HTMLElement | null = null
  private interactionHistory: Array<{ action: Action; result: ActionResult; timestamp: number }> = []

  constructor() {
    this.elementResolver = new ElementResolver()
  }

  async executeAction(action: Action): Promise<ActionResult> {
    const startTime = Date.now()

    try {
      console.log('Executing action:', action)

      let result: ActionResult

      switch (action.act) {
        case 'find':
          result = await this.findElement(action)
          break
        case 'scroll':
          result = await this.scrollToElement(action)
          break
        case 'focus':
          result = await this.focusElement(action)
          break
        case 'type':
          result = await this.typeText(action)
          break
        case 'click':
          result = await this.clickElement(action)
          break
        case 'tab':
          result = await this.pressTab(action)
          break
        case 'wait':
          result = await this.waitFor(action)
          break
        default:
          result = {
            success: false,
            message: `Unknown action: ${action.act}`,
            error: 'Invalid action type'
          }
      }

      // Record interaction
      this.interactionHistory.push({
        action,
        result,
        timestamp: Date.now()
      })

      console.log(`Action ${action.act} completed in ${Date.now() - startTime}ms:`, result)
      return result

    } catch (error) {
      const result: ActionResult = {
        success: false,
        message: `Error executing ${action.act}`,
        error: error instanceof Error ? error.message : 'Unknown error'
      }

      this.interactionHistory.push({
        action,
        result,
        timestamp: Date.now()
      })

      return result
    }
  }

  private async findElement(action: Action): Promise<ActionResult> {
    if (!action.target) {
      return { success: false, message: 'No target specified for find action' }
    }

    const match = await this.elementResolver.findElement(action.target, {
      timeout: action.timeout || 5000
    })

    if (match) {
      this.lastFocusedElement = match.element
      return {
        success: true,
        message: `Found element: ${match.reason} (confidence: ${match.confidence})`,
        element: match.element
      }
    } else {
      return {
        success: false,
        message: `Could not find element matching "${action.target}"`,
        error: 'Element not found'
      }
    }
  }

  private async scrollToElement(action: Action): Promise<ActionResult> {
    let element = this.lastFocusedElement

    if (action.target) {
      const match = await this.elementResolver.findElement(action.target)
      if (!match) {
        return { success: false, message: `Could not find element "${action.target}" to scroll to` }
      }
      element = match.element
    }

    if (!element) {
      return { success: false, message: 'No element to scroll to' }
    }

    const scrollBehavior: ScrollIntoViewOptions = {
      behavior: 'smooth',
      block: action.to === 'top' ? 'start' : action.to === 'bottom' ? 'end' : 'center',
      inline: 'nearest'
    }

    element.scrollIntoView(scrollBehavior)

    // Wait for scroll to complete
    await this.waitForScrollComplete()

    return {
      success: true,
      message: `Scrolled to element (${action.to || 'center'})`,
      element
    }
  }

  private async focusElement(action: Action): Promise<ActionResult> {
    let element = this.lastFocusedElement

    if (action.target) {
      const match = await this.elementResolver.findElement(action.target)
      if (!match) {
        return { success: false, message: `Could not find element "${action.target}" to focus` }
      }
      element = match.element
    }

    if (!element) {
      return { success: false, message: 'No element to focus' }
    }

    // Check if element can receive focus
    if (!this.canReceiveFocus(element)) {
      return { success: false, message: 'Element cannot receive focus' }
    }

    // Focus the element
    element.focus()

    // Verify focus was successful
    if (document.activeElement === element) {
      this.lastFocusedElement = element
      return {
        success: true,
        message: 'Element focused successfully',
        element
      }
    } else {
      return { success: false, message: 'Failed to focus element' }
    }
  }

  private async typeText(action: Action): Promise<ActionResult> {
    if (!action.text) {
      return { success: false, message: 'No text specified for type action' }
    }

    let element = this.lastFocusedElement

    if (action.target) {
      const match = await this.elementResolver.findElement(action.target, { type: 'input' })
      if (!match) {
        return { success: false, message: `Could not find input element "${action.target}"` }
      }
      element = match.element
    }

    if (!element) {
      return { success: false, message: 'No element to type into' }
    }

    // Check if it's a password or payment field (security restriction)
    if (this.isSensitiveField(element)) {
      return {
        success: false,
        message: 'Cannot type into password or payment fields for security reasons',
        error: 'Sensitive field restriction'
      }
    }

    // Focus element first
    element.focus()

    // Clear existing value
    if ('value' in element) {
      (element as HTMLInputElement).value = ''
    }

    // Type text naturally
    if (action.perChar) {
      await this.typeCharByChar(element, action.text)
    } else {
      await this.typeWordByWord(element, action.text)
    }

    return {
      success: true,
      message: `Typed "${action.text}" into element`,
      element
    }
  }

  private async typeCharByChar(element: HTMLElement, text: string): Promise<void> {
    for (let i = 0; i < text.length; i++) {
      const char = text[i]

      // Simulate keydown, keypress, input, keyup events
      this.dispatchKeyEvent(element, 'keydown', char)
      this.dispatchKeyEvent(element, 'keypress', char)

      // Update value
      if ('value' in element) {
        const currentValue = (element as HTMLInputElement).value
        ;(element as HTMLInputElement).value = currentValue + char
      }

      // Dispatch input event for React/Vue compatibility
      this.dispatchInputEvent(element)

      this.dispatchKeyEvent(element, 'keyup', char)

      // Natural typing delay
      await this.randomDelay(15, 40)
    }

    // Final change event
    this.dispatchChangeEvent(element)
  }

  private async typeWordByWord(element: HTMLElement, text: string): Promise<void> {
    const words = text.split(' ')

    for (let i = 0; i < words.length; i++) {
      const word = words[i]

      // Type word character by character (faster)
      for (const char of word) {
        if ('value' in element) {
          const currentValue = (element as HTMLInputElement).value
          ;(element as HTMLInputElement).value = currentValue + char
        }
        await this.randomDelay(5, 15)
      }

      // Add space if not last word
      if (i < words.length - 1) {
        if ('value' in element) {
          const currentValue = (element as HTMLInputElement).value
          ;(element as HTMLInputElement).value = currentValue + ' '
        }
      }

      // Dispatch input event per word for better React/Vue compatibility
      this.dispatchInputEvent(element)

      // Pause between words
      await this.randomDelay(50, 150)
    }

    // Final change event
    this.dispatchChangeEvent(element)
  }

  private async clickElement(action: Action): Promise<ActionResult> {
    let element = this.lastFocusedElement

    if (action.target) {
      const match = await this.elementResolver.findElement(action.target, { type: 'button' })
      if (!match) {
        return { success: false, message: `Could not find clickable element "${action.target}"` }
      }
      element = match.element
    }

    if (!element) {
      return { success: false, message: 'No element to click' }
    }

    // Security check for destructive actions
    if (action.confirm && !this.isConfirmedAction(element)) {
      return {
        success: false,
        message: 'Destructive action requires explicit user confirmation',
        error: 'Confirmation required'
      }
    }

    // Prefer clicking labels for inputs
    const clickTarget = this.getOptimalClickTarget(element)

    // Simulate realistic click events
    this.dispatchMouseEvent(clickTarget, 'mousedown')
    await this.randomDelay(50, 100)
    this.dispatchMouseEvent(clickTarget, 'mouseup')
    this.dispatchMouseEvent(clickTarget, 'click')

    return {
      success: true,
      message: 'Element clicked successfully',
      element: clickTarget
    }
  }

  private async pressTab(action: Action): Promise<ActionResult> {
    // Simulate Tab key press
    const activeElement = document.activeElement as HTMLElement

    this.dispatchKeyEvent(activeElement || document.body, 'keydown', 'Tab')
    this.dispatchKeyEvent(activeElement || document.body, 'keyup', 'Tab')

    // Wait for focus to change
    await this.waitFor({ act: 'wait', timeout: 100 })

    const newActiveElement = document.activeElement as HTMLElement
    if (newActiveElement && newActiveElement !== activeElement) {
      this.lastFocusedElement = newActiveElement
    }

    return {
      success: true,
      message: 'Tab key pressed',
      element: newActiveElement
    }
  }

  private async waitFor(action: Action): Promise<ActionResult> {
    const timeout = action.timeout || 1000
    await new Promise(resolve => setTimeout(resolve, timeout))

    return {
      success: true,
      message: `Waited for ${timeout}ms`
    }
  }

  private canReceiveFocus(element: HTMLElement): boolean {
    const focusableTypes = ['input', 'textarea', 'select', 'button', 'a']
    const tagName = element.tagName.toLowerCase()

    return (
      focusableTypes.includes(tagName) ||
      element.hasAttribute('tabindex') ||
      element.hasAttribute('contenteditable')
    )
  }

  private isSensitiveField(element: HTMLElement): boolean {
    if (!('type' in element)) return false

    const type = (element as HTMLInputElement).type?.toLowerCase()
    const sensitiveTypes = ['password', 'credit-card-number', 'cc-number', 'cc-exp', 'cc-csc']

    // Check input type
    if (sensitiveTypes.includes(type)) return true

    // Check for payment-related attributes
    const autocomplete = element.getAttribute('autocomplete')?.toLowerCase()
    const paymentFields = ['cc-name', 'cc-number', 'cc-exp', 'cc-csc', 'cc-type']

    return paymentFields.some(field => autocomplete?.includes(field))
  }

  private isConfirmedAction(element: HTMLElement): boolean {
    // For now, assume all actions are confirmed
    // In a real implementation, this would check for user confirmation
    return true
  }

  private getOptimalClickTarget(element: HTMLElement): HTMLElement {
    // For inputs, prefer clicking associated labels
    if (element.tagName.toLowerCase() === 'input') {
      const labels = this.getAssociatedLabels(element)
      if (labels.length > 0) {
        return labels[0]
      }
    }

    return element
  }

  private getAssociatedLabels(element: HTMLElement): HTMLLabelElement[] {
    const labels: HTMLLabelElement[] = []

    // Labels with 'for' attribute
    if (element.id) {
      const associatedLabels = document.querySelectorAll(`label[for="${element.id}"]`)
      labels.push(...Array.from(associatedLabels) as HTMLLabelElement[])
    }

    // Parent labels
    let parent = element.parentElement
    while (parent) {
      if (parent.tagName === 'LABEL') {
        labels.push(parent as HTMLLabelElement)
        break
      }
      parent = parent.parentElement
    }

    return labels
  }

  private dispatchKeyEvent(element: HTMLElement, type: string, key: string): void {
    const event = new KeyboardEvent(type, {
      key,
      bubbles: true,
      cancelable: true
    })

    element.dispatchEvent(event)
  }

  private dispatchInputEvent(element: HTMLElement): void {
    const event = new Event('input', {
      bubbles: true,
      cancelable: true
    })

    element.dispatchEvent(event)
  }

  private dispatchChangeEvent(element: HTMLElement): void {
    const event = new Event('change', {
      bubbles: true,
      cancelable: true
    })

    element.dispatchEvent(event)
  }

  private dispatchMouseEvent(element: HTMLElement, type: string): void {
    const rect = element.getBoundingClientRect()
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    })

    element.dispatchEvent(event)
  }

  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min
    return new Promise(resolve => setTimeout(resolve, delay))
  }

  private async waitForScrollComplete(): Promise<void> {
    return new Promise(resolve => {
      let scrollTimer: NodeJS.Timeout
      const checkScroll = () => {
        clearTimeout(scrollTimer)
        scrollTimer = setTimeout(resolve, 150)
      }

      window.addEventListener('scroll', checkScroll)
      setTimeout(() => {
        window.removeEventListener('scroll', checkScroll)
        resolve()
      }, 1000)
    })
  }

  getInteractionHistory(): Array<{ action: Action; result: ActionResult; timestamp: number }> {
    return [...this.interactionHistory]
  }

  clearHistory(): void {
    this.interactionHistory = []
  }
}