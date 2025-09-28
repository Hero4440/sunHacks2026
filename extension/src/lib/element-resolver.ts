// Element Resolver - Universal element detection using natural language
// Maps queries like "student id" or "save button" to actual DOM elements

export interface ElementMatch {
  element: HTMLElement
  score: number
  confidence: 'high' | 'medium' | 'low'
  reason: string
  selector: string
}

export interface ScoringWeights {
  labelExact: number
  labelContains: number
  nameContains: number
  idContains: number
  roleBias: number
  nearbyText: number
}

export class ElementResolver {
  private readonly weights: ScoringWeights = {
    labelExact: 3.0,
    labelContains: 2.0,
    nameContains: 1.5,
    idContains: 1.0,
    roleBias: 0.8,
    nearbyText: 0.6
  }

  private readonly CONFIDENCE_THRESHOLDS = {
    high: 4.0,
    medium: 2.5,
    low: 1.0
  }

  async findElement(target: string, options?: {
    type?: 'input' | 'button' | 'link' | 'any'
    timeout?: number
    requireVisible?: boolean
  }): Promise<ElementMatch | null> {
    const normalizedTarget = target.toLowerCase().trim()
    const searchOptions = {
      type: 'any' as const,
      timeout: 5000,
      requireVisible: true,
      ...options
    }

    const startTime = Date.now()

    while (Date.now() - startTime < searchOptions.timeout) {
      const matches = this.scoreAllElements(normalizedTarget, searchOptions.type)

      if (matches.length > 0) {
        const bestMatch = matches[0]

        // Filter by visibility if required
        if (searchOptions.requireVisible && !this.isElementVisible(bestMatch.element)) {
          // Try to scroll element into view
          bestMatch.element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          await new Promise(resolve => setTimeout(resolve, 300))

          if (!this.isElementVisible(bestMatch.element)) {
            continue // Try again
          }
        }

        // Check confidence threshold
        if (bestMatch.score >= this.CONFIDENCE_THRESHOLDS.low) {
          return bestMatch
        }
      }

      // Wait a bit before retrying (for dynamic content)
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return null
  }

  async findMultipleElements(
    target: string,
    maxResults = 3,
    options?: { type?: 'input' | 'button' | 'link' | 'any' }
  ): Promise<ElementMatch[]> {
    const normalizedTarget = target.toLowerCase().trim()
    const matches = this.scoreAllElements(normalizedTarget, options?.type || 'any')

    return matches
      .filter(match => match.score >= this.CONFIDENCE_THRESHOLDS.low)
      .slice(0, maxResults)
  }

  private scoreAllElements(target: string, type: string): ElementMatch[] {
    const elements = this.getRelevantElements(type)
    const matches: ElementMatch[] = []

    for (const element of elements) {
      const score = this.scoreElement(element, target)

      if (score > 0) {
        const confidence = this.getConfidence(score)
        const reason = this.getMatchReason(element, target)
        const selector = this.generateSelector(element)

        matches.push({
          element,
          score,
          confidence,
          reason,
          selector
        })
      }
    }

    return matches.sort((a, b) => b.score - a.score)
  }

  private getRelevantElements(type: string): HTMLElement[] {
    let selector: string

    switch (type) {
      case 'input':
        selector = 'input, textarea, select, [contenteditable]'
        break
      case 'button':
        selector = 'button, [role="button"], input[type="button"], input[type="submit"], a'
        break
      case 'link':
        selector = 'a, [role="link"]'
        break
      default:
        selector = 'input, textarea, select, button, a, [role], [contenteditable], [tabindex]'
    }

    return Array.from(document.querySelectorAll(selector))
      .filter(el => el instanceof HTMLElement) as HTMLElement[]
  }

  private scoreElement(element: HTMLElement, target: string): number {
    let score = 0

    // Get element text content and attributes
    const texts = this.getElementTexts(element)
    const attributes = this.getElementAttributes(element)

    // Score based on label associations
    score += this.scoreLabelAssociation(element, target)

    // Score based on attributes
    score += this.scoreAttributes(attributes, target)

    // Score based on nearby text
    score += this.scoreNearbyText(element, target)

    // Score based on element type bias
    score += this.scoreTypeBias(element, target)

    // Penalty for hidden or disabled elements
    if (!this.isElementInteractable(element)) {
      score *= 0.5
    }

    return score
  }

  private getElementTexts(element: HTMLElement): {
    textContent: string
    innerText: string
    value: string
  } {
    return {
      textContent: (element.textContent || '').toLowerCase().trim(),
      innerText: (element.innerText || '').toLowerCase().trim(),
      value: ('value' in element ? String(element.value) : '').toLowerCase()
    }
  }

  private getElementAttributes(element: HTMLElement): Record<string, string> {
    const attrs: Record<string, string> = {}

    // Common attributes that might contain identifying information
    const relevantAttrs = [
      'id', 'name', 'class', 'title', 'placeholder', 'aria-label',
      'aria-labelledby', 'aria-describedby', 'alt', 'data-testid',
      'data-cy', 'data-test', 'for'
    ]

    for (const attr of relevantAttrs) {
      const value = element.getAttribute(attr)
      if (value) {
        attrs[attr] = value.toLowerCase()
      }
    }

    return attrs
  }

  private scoreLabelAssociation(element: HTMLElement, target: string): number {
    let score = 0

    // Check aria-label
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase()
    if (ariaLabel) {
      if (ariaLabel === target) score += this.weights.labelExact
      else if (ariaLabel.includes(target)) score += this.weights.labelContains
    }

    // Check associated label elements
    const labels = this.getAssociatedLabels(element)
    for (const label of labels) {
      const labelText = label.textContent?.toLowerCase().trim() || ''
      if (labelText === target) score += this.weights.labelExact
      else if (labelText.includes(target)) score += this.weights.labelContains
    }

    // Check aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const referencedElement = document.getElementById(labelledBy)
      if (referencedElement) {
        const referencedText = referencedElement.textContent?.toLowerCase().trim() || ''
        if (referencedText === target) score += this.weights.labelExact
        else if (referencedText.includes(target)) score += this.weights.labelContains
      }
    }

    return score
  }

  private getAssociatedLabels(element: HTMLElement): HTMLLabelElement[] {
    const labels: HTMLLabelElement[] = []

    // Labels with 'for' attribute
    const elementId = element.id
    if (elementId) {
      const associatedLabels = document.querySelectorAll(`label[for="${elementId}"]`)
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

  private scoreAttributes(attributes: Record<string, string>, target: string): number {
    let score = 0

    // Name and placeholder attributes
    if (attributes.name?.includes(target)) score += this.weights.nameContains
    if (attributes.placeholder?.includes(target)) score += this.weights.nameContains

    // ID and class attributes
    if (attributes.id?.includes(target)) score += this.weights.idContains
    if (attributes.class?.includes(target)) score += this.weights.idContains * 0.5

    // Data attributes (test IDs, etc.)
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith('data-') && value.includes(target)) {
        score += this.weights.idContains * 0.7
      }
    }

    return score
  }

  private scoreNearbyText(element: HTMLElement, target: string): number {
    const rect = element.getBoundingClientRect()
    const searchRadius = 120 // pixels

    // Find text nodes within radius
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    )

    let score = 0
    let node: Node | null

    while ((node = walker.nextNode())) {
      if (node.textContent && node.parentElement) {
        const parentRect = node.parentElement.getBoundingClientRect()
        const distance = this.getDistance(rect, parentRect)

        if (distance <= searchRadius) {
          const text = node.textContent.toLowerCase().trim()
          if (text.includes(target)) {
            const proximity = Math.max(0, 1 - (distance / searchRadius))
            score += this.weights.nearbyText * proximity
          }
        }
      }
    }

    return score
  }

  private scoreTypeBias(element: HTMLElement, target: string): number {
    const tagName = element.tagName.toLowerCase()
    const type = element.getAttribute('type')?.toLowerCase()
    const role = element.getAttribute('role')?.toLowerCase()

    // Common patterns for button-like targets
    const buttonTargets = ['save', 'submit', 'send', 'continue', 'next', 'confirm', 'ok']
    const isButtonTarget = buttonTargets.some(bt => target.includes(bt))

    // Common patterns for input-like targets
    const inputTargets = ['email', 'password', 'name', 'id', 'phone', 'address', 'search']
    const isInputTarget = inputTargets.some(it => target.includes(it))

    let score = 0

    if (isButtonTarget && (tagName === 'button' || type === 'submit' || role === 'button')) {
      score += this.weights.roleBias
    }

    if (isInputTarget && (tagName === 'input' || tagName === 'textarea' || role === 'textbox')) {
      score += this.weights.roleBias
    }

    return score
  }

  private getDistance(rect1: DOMRect, rect2: DOMRect): number {
    const center1 = { x: rect1.left + rect1.width / 2, y: rect1.top + rect1.height / 2 }
    const center2 = { x: rect2.left + rect2.width / 2, y: rect2.top + rect2.height / 2 }

    return Math.sqrt(
      Math.pow(center1.x - center2.x, 2) + Math.pow(center1.y - center2.y, 2)
    )
  }

  private isElementVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0' &&
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    )
  }

  private isElementInteractable(element: HTMLElement): boolean {
    if (element.hasAttribute('disabled')) return false

    const style = window.getComputedStyle(element)
    if (style.pointerEvents === 'none') return false

    return this.isElementVisible(element)
  }

  private getConfidence(score: number): 'high' | 'medium' | 'low' {
    if (score >= this.CONFIDENCE_THRESHOLDS.high) return 'high'
    if (score >= this.CONFIDENCE_THRESHOLDS.medium) return 'medium'
    return 'low'
  }

  private getMatchReason(element: HTMLElement, target: string): string {
    const reasons: string[] = []

    // Check what contributed to the match
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase()
    if (ariaLabel?.includes(target)) {
      reasons.push('aria-label match')
    }

    const labels = this.getAssociatedLabels(element)
    if (labels.some(label => label.textContent?.toLowerCase().includes(target))) {
      reasons.push('associated label')
    }

    const name = element.getAttribute('name')?.toLowerCase()
    if (name?.includes(target)) {
      reasons.push('name attribute')
    }

    const placeholder = element.getAttribute('placeholder')?.toLowerCase()
    if (placeholder?.includes(target)) {
      reasons.push('placeholder text')
    }

    return reasons.length > 0 ? reasons.join(', ') : 'nearby text or element type'
  }

  private generateSelector(element: HTMLElement): string {
    // Generate a robust CSS selector for the element
    const parts: string[] = []

    // Add tag name
    parts.push(element.tagName.toLowerCase())

    // Add ID if present
    if (element.id) {
      parts.push(`#${element.id}`)
    }

    // Add significant classes
    if (element.className) {
      const classes = element.className
        .split(' ')
        .filter(cls => cls.length > 0 && !cls.match(/^(ng-|_|x-)/)) // Filter out framework classes
        .slice(0, 2) // Limit to 2 classes

      if (classes.length > 0) {
        parts.push(`.${classes.join('.')}`)
      }
    }

    // Add type attribute for inputs
    const type = element.getAttribute('type')
    if (type) {
      parts.push(`[type="${type}"]`)
    }

    return parts.join('')
  }
}