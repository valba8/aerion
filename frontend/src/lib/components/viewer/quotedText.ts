// Detects the trailing quoted portion of a reply (the "On X, Y wrote:" block
// and everything below it) so the viewer can collapse it behind a toggle.

export const QUOTE_WRAPPER_CLASS = 'aerion-quote'
export const QUOTE_TOGGLE_CLASS = 'aerion-quote-toggle'

// Client-specific markers for where the quoted part of a reply starts.
const QUOTE_START_SELECTORS = [
  '.gmail_quote', // Gmail
  '#divRplyFwdMsg', // Outlook
  '#appendonsend', // Outlook
  '.moz-cite-prefix', // Thunderbird
  '.yahoo_quoted', // Yahoo
  '.protonmail_quote', // Proton
  'div[data-marker="__QUOTED_TEXT__"]', // Zimbra
]

const FORWARD_PATTERN = /forwarded message|mensaje reenviado|message transféré|weitergeleitete nachricht|messaggio inoltrato/i

function hasText(node: Node | null): boolean {
  if (!node) return false
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).querySelector('img')) return true
  return (node.textContent || '').trim().length > 0
}

// True when no visible content follows `el` anywhere in the document.
function isTrailing(el: Element, body: HTMLElement): boolean {
  let cur: Element | null = el
  while (cur && cur !== body) {
    for (let sib = cur.nextSibling; sib; sib = sib.nextSibling) {
      if (hasText(sib)) return false
    }
    cur = cur.parentElement
  }
  return true
}

function findQuoteStart(body: HTMLElement): Element | null {
  for (const selector of QUOTE_START_SELECTORS) {
    const el = body.querySelector(selector)
    // Forwards reuse the same markup, but there the "quote" is the content
    if (el && !FORWARD_PATTERN.test((el.textContent || '').slice(0, 300))) return el
  }

  // Generic fallback: the last top-level blockquote, as long as it's trailing
  // (interleaved replies keep their quotes visible)
  const quotes = Array.from(body.querySelectorAll('blockquote')).filter(q => !q.parentElement?.closest('blockquote'))
  const last = quotes[quotes.length - 1]
  if (!last || !isTrailing(last, body)) return null

  // Pull in the attribution line ("On ..., X wrote:") right above it
  let prev = last.previousElementSibling
  while (prev && !hasText(prev)) prev = prev.previousElementSibling
  if (prev && /:\s*$/.test(prev.textContent || '') && (prev.textContent || '').length < 300) return prev
  return last
}

/**
 * Wraps the quoted part of an HTML email in a hidden container preceded by a
 * toggle button. Returns the input unchanged when no quote is found.
 */
export function collapseQuotedHtml(html: string, expanded: boolean, toggleTitle: string): string {
  if (!html) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const start = findQuoteStart(doc.body)
  if (!start?.parentNode) return html

  // Outlook puts an <hr> separator just before its reply header
  let first: Element = start
  const prev = start.previousElementSibling
  if (prev?.tagName === 'HR') first = prev

  const parent = first.parentNode!
  const wrapper = doc.createElement('div')
  wrapper.className = QUOTE_WRAPPER_CLASS
  if (!expanded) wrapper.hidden = true
  parent.insertBefore(wrapper, first)
  while (wrapper.nextSibling) wrapper.appendChild(wrapper.nextSibling)

  // Don't collapse a message that is nothing but a quote
  const rest = doc.body.cloneNode(true) as HTMLElement
  rest.querySelector(`.${QUOTE_WRAPPER_CLASS}`)?.remove()
  if (!hasText(rest)) return html

  const toggle = doc.createElement('button')
  toggle.type = 'button'
  toggle.className = QUOTE_TOGGLE_CLASS
  toggle.title = toggleTitle
  toggle.setAttribute('aria-label', toggleTitle)
  toggle.setAttribute('aria-expanded', String(expanded))
  toggle.textContent = '•••'
  parent.insertBefore(toggle, wrapper)

  return doc.head.innerHTML + doc.body.innerHTML
}

const ATTRIBUTION_PATTERN = /^.{0,300}(wrote|escribió|a écrit|schrieb|ha scritto|escreveu|napsal|napisał|skrev|yazdı):\s*$/i
const ORIGINAL_MESSAGE_PATTERN = /^-{2,}\s*(original message|mensaje original|message d'origine|ursprüngliche nachricht|messaggio originale)\s*-{2,}\s*$/i

/**
 * Splits a plain-text body into the reply and its trailing quoted part.
 * `quoted` is empty when the body has no trailing quote.
 */
export function splitQuotedText(text: string): { main: string; quoted: string } {
  if (!text) return { main: text, quoted: '' }
  const lines = text.split(/\r?\n/)

  let start = lines.findIndex(l => ORIGINAL_MESSAGE_PATTERN.test(l.trim()))
  if (start === -1) {
    // First line of a block of ">" lines that runs to the end of the message
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line === '') continue
      if (line.startsWith('>')) start = i
      else break
    }
    if (start !== -1) {
      let prev = start - 1
      while (prev >= 0 && lines[prev].trim() === '') prev--
      if (prev >= 0 && ATTRIBUTION_PATTERN.test(lines[prev].trim())) start = prev
    }
  }

  if (start === -1) return { main: text, quoted: '' }
  const main = lines.slice(0, start).join('\n').trimEnd()
  if (!main.trim()) return { main: text, quoted: '' }
  return { main, quoted: lines.slice(start).join('\n') }
}
