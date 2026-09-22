import { createHash } from "node:crypto"
import { XMLParser, XMLValidator } from "fast-xml-parser"
import type { ReportedOperatingCohort } from "./reported-operating-result"

interface FilingIdentity {
  cik: string
  accessionNumber: string
  filed: string
  form: string
  documentUrl: string
}

type OrderedNode = Record<string, unknown>
interface Cell { text: string; start: number; end: number }
interface Row { cells: Cell[]; width: number }
const cik = "0001594805"
const scale = 1_000_000
const title = "Summary of Quarterly Results"

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function tag(node: OrderedNode): string | undefined {
  return Object.keys(node).find(key => key !== ":@" && key !== "#text" && !key.startsWith("?"))
}

function children(node: OrderedNode): OrderedNode[] {
  const key = tag(node)
  return key && Array.isArray(node[key]) ? node[key] as OrderedNode[] : []
}

function content(nodes: OrderedNode[]): string {
  return nodes.map(node => typeof node["#text"] === "string" ? node["#text"] : content(children(node))).join("")
}

function attrs(node: OrderedNode): Record<string, string> {
  return (node[":@"] ?? {}) as Record<string, string>
}

function containsTable(nodes: OrderedNode[]): boolean {
  return nodes.some(node => ["table", "tr", "td", "th"].includes(tag(node) ?? "") || containsTable(children(node)))
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

function validIdentity(filing: FilingIdentity): boolean {
  if (!/^0*1594805$/.test(filing.cik) || !/^0001594805-\d{2}-\d{6}$/.test(filing.accessionNumber)
    || !["10-K", "10-Q"].includes(filing.form) || !validDate(filing.filed)) return false
  try {
    const url = new URL(filing.documentUrl)
    const path = `/Archives/edgar/data/1594805/${filing.accessionNumber.replaceAll("-", "")}/`
    return url.protocol === "https:" && url.hostname === "www.sec.gov" && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.startsWith(path) && /^[A-Za-z0-9_-]+\.html?$/.test(url.pathname.slice(path.length))
      && filing.documentUrl === url.href
  } catch { return false }
}

function parseRow(node: OrderedNode): Row | null {
  const cells: Cell[] = []
  let width = 0
  for (const cell of children(node)) {
    if (!tag(cell) && !normalizedText(content([cell]))) continue
    if (tag(cell) !== "td" && tag(cell) !== "th") return null
    if (containsTable(children(cell))) return null
    const attributes = attrs(cell)
    const colspan = attributes["@_colspan"] ?? "1"
    if (!/^[1-9]\d?$/.test(colspan) || (attributes["@_rowspan"] ?? "1") !== "1") return null
    const span = Number(colspan)
    cells.push({ text: normalizedText(content(children(cell))), start: width, end: width + span })
    width += span
    if (width > 200) return null
  }
  return cells.length ? { cells, width } : null
}

function tableRows(table: OrderedNode): Row[] | null {
  const rows: Row[] = []
  function walk(nodes: OrderedNode[]): boolean {
    for (const node of nodes) {
      const name = tag(node)
      if (name === "tr") {
        const row = parseRow(node)
        if (!row) return false
        rows.push(row)
      } else if (name === "tbody" || name === "thead" || name === "tfoot") {
        if (!walk(children(node))) return false
      } else if (name || normalizedText(content([node]))) return false
    }
    return true
  }
  return walk(children(table)) ? rows : null
}

function quarterDate(value: string): string | null {
  const match = /^(Mar 31|Jun 30|Sep 30|Dec 31), (\d{4})$/.exec(value)
  if (!match) return null
  const suffix: Record<string, string> = { "Mar 31": "03-31", "Jun 30": "06-30", "Sep 30": "09-30", "Dec 31": "12-31" }
  const date = `${match[2]}-${suffix[match[1]!]}`
  return validDate(date) ? date : null
}

function printedNumber(value: string): number | null {
  // A dash/blank is not evidence of a reported zero. Do not repair malformed commas.
  if (!/^(?:-?(?:\d+|\d{1,3}(?:,\d{3})+)|\((?:\d+|\d{1,3}(?:,\d{3})+)\))$/.test(value)) return null
  const negative = value.startsWith("(")
  const number = Number(value.replace(/[(),]/g, "")) * (negative ? -1 : 1) * scale
  return Number.isSafeInteger(number) ? number : null
}

/** Only the issuer's identified, directly printed quarterly summary is accepted.
 * Unknown layouts, ambiguous tables and invalid evidence produce no overlay. */
export function parseShopOperatingTable(html: string, filing: FilingIdentity): ReportedOperatingCohort[] {
  if (!validIdentity(filing) || html.length > 20_000_000 || /<!DOCTYPE|<!ENTITY/i.test(html)) return []
  try {
    if (XMLValidator.validate(html) !== true) return []
    const document = new XMLParser({ preserveOrder: true, ignoreAttributes: false,
      parseTagValue: false, trimValues: false, processEntities: true, htmlEntities: true }).parse(html) as OrderedNode[]
    const identities: string[] = []
    const tables: OrderedNode[] = []
    let pendingHeadings = 0
    let namespace = false
    let invalid = false
    function walk(nodes: OrderedNode[], visible = true): void {
      for (const node of nodes) {
        const name = tag(node)
        const attributes = attrs(node)
        if (name === "html") namespace = /^https?:\/\/xbrl\.sec\.gov\/dei\/\d{4}$/.test(attributes["@_xmlns:dei"] ?? "")
          && attributes["@_xmlns:ix"] === "http://www.xbrl.org/2013/inlineXBRL"
        if (name === "ix:nonNumeric" && attributes["@_name"] === "dei:EntityCentralIndexKey") {
          identities.push(normalizedText(content(children(node))))
        }
        const rendered = visible && !["script", "style", "ix:header", "a"].includes(name ?? "")
          && !/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes["@_style"] ?? "")
          && attributes["@_hidden"] === undefined
        const inner = children(node)
        // Bind to an exact visible section heading, not a table-of-contents
        // link or prose mentioning the section. Count the innermost element.
        if (rendered && ["h1", "h2", "h3", "h4", "h5", "h6", "span", "div", "p", "strong", "b"].includes(name ?? "")
          && normalizedText(content(inner)) === title
          && !inner.some(child => tag(child) && normalizedText(content(children(child))) === title)) pendingHeadings++
        if (name === "table") {
          if (rendered && pendingHeadings > 1) invalid = true
          if (rendered && pendingHeadings === 1) tables.push(node)
          if (rendered) pendingHeadings = 0
        } else walk(inner, rendered)
      }
    }
    walk(document)
    if (invalid || !namespace || identities.length !== 1 || identities[0] !== cik || tables.length !== 1) return []
    const parsedRows = tableRows(tables[0]!)
    if (!parsedRows) return []
    const rows: Row[] = parsedRows
    const headerRows = rows.filter(row => row.cells.some(cell => quarterDate(cell.text)))
    if (headerRows.length !== 1) return []
    const header = headerRows[0]!
    const dates = header.cells.filter(cell => cell.text).map(cell => ({ ...cell, date: quarterDate(cell.text) }))
    if (dates.length < 2 || dates.length > 12 || dates.some(cell => !cell.date || cell.date >= filing.filed)
      || new Set(dates.map(cell => cell.date)).size !== dates.length) return []
    const first = dates[0]!.start
    const width = header.width
    const spanningHeader = (pattern: RegExp): Row[] => rows.filter(row => {
      const nonempty = row.cells.filter(cell => cell.text)
      return row.width === width && nonempty.length === 1 && nonempty[0]!.start === first
        && nonempty[0]!.end === width && pattern.test(nonempty[0]!.text)
    })
    const duration = spanningHeader(/^Three months ended$/)
    const units = spanningHeader(/^\(in US \$ millions, except per share (?:data|amounts)\)$/)
    const headerIndex = rows.indexOf(header)
    if (duration.length !== 1 || units.length !== 1 || rows.indexOf(duration[0]!) >= headerIndex
      || rows.indexOf(units[0]!) <= headerIndex
      || rows.some(row => row.cells.some(cell => /(?:six|nine|twelve) months ended|year[s]? ended|year.to.date/i.test(cell.text)))) return []

    const label = (row: Row): string => row.cells.filter(cell => cell.end <= first).map(cell => cell.text).join("").trim()
    function values(row: Row): number[] | null {
      if (row.width !== width || row.cells.some(cell => cell.start < first && cell.end > first)) return null
      const result: number[] = []
      for (let index = 0; index < dates.length; index++) {
        const start = dates[index]!.start
        const end = dates[index + 1]?.start ?? width
        const cells = row.cells.filter(cell => cell.text && cell.start >= start && cell.start < end)
        if (cells.length !== 1 || cells[0]!.end > end) return null
        const value = printedNumber(cells[0]!.text)
        if (value === null) return null
        result.push(value)
      }
      return result
    }
    function required(name: string): number[] | null {
      const matches = rows.filter(row => label(row) === name)
      return matches.length === 1 && rows.indexOf(matches[0]!) > rows.indexOf(units[0]!) ? values(matches[0]!) : null
    }
    const grossProfit = required("Gross profit")
    const operatingExpense = required("Total operating expenses")
    const operatingIncome = required("Income from operations")
    if (!grossProfit || !operatingExpense || !operatingIncome) return []

    function subtotal(startLabel: RegExp, endLabel: RegExp): number[] | undefined {
      const starts = rows.map((row, index) => startLabel.test(label(row)) ? index : -1).filter(index => index >= 0)
      const ends = rows.map((row, index) => endLabel.test(label(row)) ? index : -1).filter(index => index >= 0)
      if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) return undefined
      const region = rows.slice(starts[0]! + 1, ends[0]!)
      const candidates = region.filter(row => !label(row) && row.cells.some(cell => cell.text))
      return candidates.length === 1 ? values(candidates[0]!) ?? undefined : undefined
    }
    const totalRevenue = subtotal(/^Revenues$/, /^Cost of revenues(?:\(\d+\))*$/)
    const costOfRevenue = subtotal(/^Cost of revenues(?:\(\d+\))*$/, /^Gross profit$/)
    // These directly reported subtotals are validation anchors, never operands
    // used to manufacture missing operating facts. Integer-million rounding
    // can cause a one-million difference among three printed amounts.
    if (dates.some((_, index) => Math.abs(grossProfit[index]! - operatingExpense[index]! - operatingIncome[index]!) > scale
      || (totalRevenue && costOfRevenue && Math.abs(totalRevenue[index]! - costOfRevenue[index]! - grossProfit[index]!) > scale))) return []
    const documentSha256 = createHash("sha256").update(html).digest("hex")
    return dates.map((column, index) => {
      const endDate = column.date!
      const month = Number(endDate.slice(5, 7)) - 2
      const anchors = { ...(totalRevenue ? { totalRevenue: totalRevenue[index]! } : {}),
        ...(costOfRevenue ? { costOfRevenue: costOfRevenue[index]! } : {}) }
      return { cik, period: "quarterly", startDate: `${endDate.slice(0, 4)}-${String(month).padStart(2, "0")}-01`, endDate,
        currency: "USD", accessionNumber: filing.accessionNumber, filed: filing.filed, form: filing.form,
        values: { grossProfit: grossProfit[index]!, operatingExpense: operatingExpense[index]!, operatingIncome: operatingIncome[index]! },
        ...(Object.keys(anchors).length ? { anchors } : {}),
        origin: { kind: "filing-table", documentUrl: filing.documentUrl, documentSha256, table: "summary-quarterly-results", unitScale: scale } }
    })
  } catch { return [] }
}
