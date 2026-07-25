/**
 * Does the campaign hold its place between visits?
 *
 * Everything else in `tools/` plays a battle. This plays the thing around the
 * battles: which of the eight are open, what a win writes down, and where a
 * reload lands. It is worth a harness because the failure is silent and nobody
 * would meet it twice in a sitting: progress that does not persist looks exactly
 * like a fresh start, which is also what a first visit looks like.
 *
 *   npm run dev
 *   npx tsx tools/campaign.ts
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const faults: string[] = []
page.on('console', (m) => m.type() === 'error' && faults.push(m.text()))
page.on('pageerror', (e) => faults.push(String(e)))

function check(claim: string, got: unknown, want: unknown): void {
  const ok = String(got) === String(want)
  if (!ok) faults.push(`${claim}: ${got} rather than ${want}`)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${claim}${ok ? '' : ` -> ${got}`}`)
}

/** What the screen in front of the player is, in one word, plus its heading. */
const heading = () => page.$eval('.card h1', (n) => n.textContent ?? '')
/** The mark against each battle, which is the whole state of the campaign. */
const marks = () => page.$$eval('.battles .mark', (n) => n.map((m) => m.textContent).join(' '))

async function open(url: string): Promise<void> {
  await page.goto(`${URL}${url}`, { waitUntil: 'networkidle' })
  await page.waitForFunction('window.cs !== undefined')
}

console.log('a first visit')
await open('/')
check('lands in the tutorial briefing', await heading(), 'First Contact')
await page.click('.card button:not(.go)')
check('the briefing opens the campaign', await heading(), 'Choose a battle')
check('with one battle open', await marks(), 'next locked locked locked locked locked locked locked')
check(
  'and seven refusing the click',
  await page.$$eval('.battles button', (n) => n.filter((b) => (b as HTMLButtonElement).disabled).length),
  7,
)

console.log('taking the first battle')
await page.click('.battles button:nth-child(1)')
check('the campaign opens a briefing', await heading(), 'First Contact')
await page.click('.card button.go')
// Killing red outright rather than flying it: this harness is about the screens
// around a battle, and tools/hands.ts is what plays one.
await page.evaluate('window.cs.world.ships.filter((s) => s.side === "red").forEach((s) => (s.hp = 0))')
await page.waitForSelector('.card.won', { timeout: 20000 })
check('the report says so', await heading(), 'the volume is yours')
await page.click('.card button:text("all battles")')
check('the win opened the second battle', await marks(), 'taken next locked locked locked locked locked locked')
check('and was written down by id', await page.evaluate('localStorage.getItem("commandschool.taken")'), 'first-contact')

console.log('coming back')
await open('/')
check('a return visit lands on the campaign', await heading(), 'Choose a battle')
check('with the win still on it', await marks(), 'taken next locked locked locked locked locked locked')
check(
  'focused on the battle you are up to',
  await page.evaluate('document.activeElement.querySelector(".name").textContent'),
  'The Enemy Gate Is Down',
)
await page.click('.battles button:nth-child(1)')
check('and a taken battle open to fly again', await heading(), 'First Contact')

console.log('the door the harnesses use')
await open('/?m=last-exam&seed=2000&hold=1')
check('names a battle past the campaign screen', await heading(), 'The Last Exam')

for (const f of faults) console.log(`  ${f}`)
console.log(faults.length === 0 ? 'campaign holds' : `${faults.length} faults`)
await browser.close()
process.exit(faults.length === 0 ? 0 : 1)
