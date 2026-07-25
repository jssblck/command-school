import { cls } from '../sim/classes'
import { DEVICE_RADIUS, DEVICE_RANGE } from '../sim/step'
import { aliveCount, fleetStrength } from '../sim/world'
import type { Scenario } from '../sim/scenarios'
import type { ClassId, Order, Squadron, World } from '../sim/types'
import type { Controls, LogLine } from './controls'

/** Terse element builder, because the alternative is a hundred lines of appendChild. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const STANCE_MARK: Record<Squadron['stance'], string> = { tight: '===', open: '= =', wide: '=  =' }

/**
 * The command console: everything the player knows that is not visible in the
 * volume. It is deliberately text, dense and unanimated, because the volume is
 * where the eye is supposed to be and a panel that moves steals attention the
 * battle has a better claim on.
 *
 * The one thing the console must never do is report a fact the player's squadron
 * leaders could not have told them. So the roster shows blue in detail and red as
 * a single strength number, and that number is drawn from sensors.
 */
export class Hud {
  private readonly header = el('div', 'hud-header')
  private readonly title = el('div', 'hud-title')
  private readonly objective = el('div', 'hud-objective')
  private readonly clock = el('div', 'hud-clock')
  private readonly scales = el('div', 'hud-scales')
  private readonly blueBar = el('i')
  private readonly redBar = el('i')
  private readonly roster = el('div', 'hud-roster')
  private readonly comm = el('div', 'hud-comm')
  private readonly armed = el('div', 'hud-armed')
  private readonly legend = el('div', 'hud-legend')
  private readonly rows = new Map<number, RosterRow>()
  /** Sequence number of the next comm line this has not drawn yet. */
  private drawn = 0
  private rosterKey = ''

  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
    private readonly controls: Controls,
    scenario: Scenario,
  ) {
    this.title.textContent = scenario.name.toUpperCase()
    this.objective.textContent = world.objective.text
    this.header.append(this.title, this.objective, this.clock)

    const blue = el('div', 'hud-scale blue')
    blue.append(el('label', undefined, 'OURS'), this.blueBar)
    const red = el('div', 'hud-scale red')
    red.append(el('label', undefined, 'THEIRS'), this.redBar)
    this.scales.append(blue, red)

    this.legend.innerHTML = LEGEND
    this.root.append(this.header, this.scales, this.roster, this.comm, this.armed, this.legend)
  }

  update(): void {
    const w = this.world
    const c = this.controls

    // T+ stays because every line in the comm channel is stamped against it, but on a
    // mission scored against a clock the number that decides it is the one remaining, and
    // printing only the objective text made the player subtract at every glance while
    // commanding under eight tenths of a second of comm delay.
    const left = w.objective.seconds === undefined ? null : Math.max(0, w.objective.seconds - w.t)
    this.clock.textContent =
      `T+${w.t.toFixed(1)}` +
      (left === null ? '' : `   ${left.toFixed(0)}s LEFT`) +
      (c.paused ? '   HELD' : c.speed !== 1 ? `   x${c.speed}` : '')
    this.clock.classList.toggle('held', c.paused)

    // Both bars are scaled against blue's opening strength rather than each their
    // own, so the pair reads as a balance of force instead of two full bars.
    const base = Math.max(1, w.stats.blueStart)
    this.blueBar.style.width = `${Math.min(100, (fleetStrength(w, 'blue') / base) * 100)}%`
    this.redBar.style.width = `${Math.min(100, (this.seenStrength() / base) * 100)}%`

    this.drawRoster()
    this.drawComm()
    this.drawArmed()
  }

  /**
   * Red's strength as blue can see it, which early in a battle is nearly nothing.
   * A truthful enemy strength bar would be a free reconnaissance report.
   */
  private seenStrength(): number {
    let pts = 0
    for (const s of this.world.ships) {
      if (!s.alive || s.side === 'blue') continue
      if (this.world.seen.blue.has(s.id)) pts += cls(s.cls).cost
    }
    return pts
  }

  /**
   * The roster is built once and then only updated, because it lists every wing for
   * the whole battle including the ones that are gone. A row that disappears takes the
   * number beside it with it and hands that number to the wing below, which is how an
   * order meant for a courier ended up going to an artillery wing.
   */
  private drawRoster(): void {
    const roster = this.controls.roster()
    const key = roster.map((sq) => sq.id).join(',')
    if (key !== this.rosterKey) {
      this.rosterKey = key
      this.roster.replaceChildren()
      this.rows.clear()
      roster.forEach((sq, i) => {
        const row = new RosterRow(sq, i + 1, this.controls)
        this.rows.set(sq.id, row)
        this.roster.append(row.node)
      })
    }
    for (const sq of roster) this.rows.get(sq.id)?.update(this.world, this.controls)
  }

  private drawComm(): void {
    // Draw whatever has been said since the last frame, by sequence rather than by
    // position: the log is a ring, and once it is full its length stops changing.
    for (const line of this.controls.log) {
      if (line.seq < this.drawn) continue
      this.drawn = line.seq + 1
      // A fleet under standing orders says the same thing over and over: re-tasking a
      // pair of wings every couple of seconds filled six of the nine lines the channel
      // holds with "2 wings acknowledge" and pushed three hull losses off the bottom.
      // A repeat counts up on the line already there, which keeps the fact and the room.
      const last = this.comm.lastElementChild as HTMLElement | null
      if (last?.dataset.text === line.text) tallyLine(last, line)
      else this.comm.append(commLine(line))
    }
    while (this.comm.childElementCount > 9) this.comm.firstElementChild!.remove()
  }

  /**
   * The device panel, which exists for exactly one reason: the cascade does not care
   * whose hulls it eats, so the player is told what it will cost them before they let
   * go of it rather than after.
   *
   * The cost is a standoff and not a body count. Counting your own hulls in the blast
   * reads zero for almost every shot worth taking and is still wrong, because the
   * cascade spends two seconds walking outward and what it eats is whatever flies into
   * it in the meantime: aiming a charge at eighteen needles with your own wing a
   * hundred and sixteen units back reads as costing nothing and takes all fourteen of
   * yours. Against how far this chain walks, the same shot reads as what it is.
   *
   * The standoff skips the firing wing, so the line answers a question the player can
   * still act on. Whoever releases a charge is inside the burst no matter where they
   * aim, since release range is a quarter of the walk, and a line that says so on every
   * shot in the game is a line nobody reads twice. The briefings carry that rule; the
   * panel carries the part that changes between one shot and the next.
   */
  private drawArmed(): void {
    const c = this.controls
    if (c.mode !== 'device') {
      this.armed.classList.remove('on')
      return
    }
    this.armed.classList.add('on')
    const shot = c.shot
    const lines = [`${c.primary()?.name ?? '---'}   DEVICE ARMED`]
    // Against the limit rather than on its own. A carrier threading toward a
    // planet is asking how much reach is left, and a bare distance does not
    // answer that.
    if (shot) lines.push(shot.ok ? `range ${Math.round(shot.range)} of ${DEVICE_RANGE}` : 'OUT OF REACH')
    if (shot?.ok) {
      // The objective before the butcher's bill, because on a mission scored against a
      // world the hull counts are the price and this is the thing being bought.
      const obj = shot.objective
      if (obj) {
        // The claim has to be gated on the fuse. A pixel forty off the limb resolves to
        // open space that is still well inside a device radius of the rock, so it read
        // "the flash itself catches Hive" while the charge armed against hulls instead
        // and tripped fifty out on the garrison. Aim and burst point are the same place
        // only when something solid stops the bolt.
        lines.push(
          obj.off > 0
            ? `${Math.round(obj.off)} SHY OF ${obj.name.toUpperCase()}, ONLY THE WALK GETS THERE`
            : shot.surface
              ? `the flash itself catches ${obj.name}`
              : `NOTHING SOLID UNDER THE AIM: A HULL ON THE LINE TRIPS IT SHORT OF ${obj.name.toUpperCase()}`,
        )
      }
      // Both counts walk the whole chain from where every hull is standing right now, with
      // every generation assumed to catch. That is an estimate and it was printed as a floor,
      // "AT LEAST n OF YOURS", on a comment that said it counted the first flash alone. It
      // does not, and the estimate is a good one: a retreat on Overwhelm released on a panel
      // reading 13 of theirs and 24 of ours, and the cascade took 11 and 24. So the line says
      // where the count comes from and claims nothing about the walk, which is a chain of coin
      // flips at 0.86 apiece and runs a hull or two short of this when one of them misses.
      //
      // Our own were counted all along and not printed, on the reasoning that the number is
      // nearly always zero. Then an aim that had snapped back onto the carrier read "takes 0
      // of theirs, fleet clear" over a shot that killed all ten hulls holding the charge.
      lines.push(`cascade reaches ${shot.cascade.red} of theirs where they stand`)
      if (shot.cascade.blue > 0) lines.push(`AND ${shot.cascade.blue} OF YOURS`)
      // The standoff is a distance to the nearest hull of ours the walk could reach, and
      // by the time the exam is decided there is often nobody else left: printing it raw
      // put the line "fleet Infinity out, clear of the walk" on the panel the whole
      // campaign builds toward.
      //
      // Measured against this chain and not against the weapon's 455, which is the reach a
      // chain gets when every generation finds another hull to jump from. Warning on 455
      // shouted at five releases that each cost the fleet nothing, and the shout was in
      // capitals every time; the drawn chain had stopped a couple of hundred units short of
      // the nearest wing, in plain sight, saying the opposite. One hop of margin on top, since a hull that flies into the fringe
      // while the bolt is out extends the chain by about a first flash.
      const bite = shot.cascade.reach + DEVICE_RADIUS
      lines.push(
        !Number.isFinite(shot.standoff)
          ? 'nobody else of ours is left for it to reach'
          : shot.standoff < bite
            ? `REST OF THE FLEET ${Math.round(shot.standoff)} OUT, THIS CHAIN WALKS ${Math.round(bite)}`
            : `fleet ${Math.round(shot.standoff)} out, the chain stops ${Math.round(bite)} from the burst`,
      )
    }
    lines.push('click to release, right click to stand down')
    this.armed.replaceChildren(
      ...lines.map((t, i) => el('div', i === 0 || t === t.toUpperCase() ? 'hot' : undefined, t)),
    )
  }
}

function commLine(line: LogLine): HTMLElement {
  const node = el('div', `comm ${line.tone}`)
  node.dataset.text = line.text
  node.dataset.times = '1'
  node.append(el('span', 'at', `${line.at.toFixed(0)}`), el('span', 'text', line.text))
  return node
}

/**
 * Fold a repeat into the line above it: the clock moves to the latest saying of it, so
 * the timestamp column stays in order, and the count says how many there were.
 */
function tallyLine(node: HTMLElement, line: LogLine): void {
  const times = Number(node.dataset.times ?? '1') + 1
  node.dataset.times = String(times)
  node.querySelector('.at')!.textContent = line.at.toFixed(0)
  const tally = node.querySelector('.times') ?? node.appendChild(el('span', 'times'))
  tally.textContent = `x${times}`
}

/**
 * One squadron. The row has to answer, at a glance and without being read: is it
 * selected, how many hulls are left, how spread out is it, and is it doing
 * something or waiting for me.
 */
class RosterRow {
  readonly node = el('button', 'sq')
  private readonly count = el('span', 'count')
  private readonly bar = el('i')
  private readonly state = el('span', 'state')

  constructor(
    private readonly sq: Squadron,
    key: number,
    controls: Controls,
  ) {
    const wrap = el('span', 'bar')
    wrap.append(this.bar)
    this.node.append(
      el('span', 'key', String(key)),
      el('span', 'name', sq.name),
      el('span', 'cls', cls(sq.cls).name.toLowerCase()),
      this.count,
      wrap,
      this.state,
    )
    this.node.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      if (!e.shiftKey) controls.selected.clear()
      controls.selected.add(sq.id)
    })
  }

  update(w: World, c: Controls): void {
    const sq = this.sq
    const alive = aliveCount(w, sq)
    const start = alive + sq.lost
    this.count.textContent = `${alive}/${start}`
    this.bar.style.width = `${start > 0 ? (alive / start) * 100 : 0}%`
    this.node.classList.toggle('sel', c.selected.has(sq.id))
    this.node.classList.toggle('hov', c.hover === sq.id)
    this.node.classList.toggle('dead', alive === 0)
    this.node.classList.toggle('hurt', start > 0 && alive / start < 0.4)

    // A wiped wing keeps its number and its name, because renumbering the roster mid
    // battle would move every key under the player's fingers, but it stops reporting
    // orders. It is not engaging anything. On the last exam four of the five rows are
    // wiped by T+22 and each was still narrating a manoeuvre, which reads as a fleet
    // that is still out there doing what it was told.
    if (alive === 0) {
      this.state.textContent = 'lost'
      return
    }

    // A signal is shown with a leading ellipsis for the whole time it is in the channel,
    // which is the only feedback that a command was even heard. The stance mark sits inside
    // the ellipsis along with the order, because the shape travels in the same signal: the
    // mark ahead of the ellipsis would read as a wing already flying the shape it has only
    // just been asked for, which is the reading the ellipsis exists to prevent.
    const sent = sq.pending
    const said = sent
      ? `... ${STANCE_MARK[sent.stance]} ${orderText(w, sq.cls, sent.order)}`
      : `${STANCE_MARK[sq.stance]} ${orderText(w, sq.cls, sq.order)}`
    this.state.textContent = `${said}${sq.device > 0 ? ` *${sq.device}` : ''}`
  }
}

/**
 * The roster's second line. It takes the wing's class because a scout under an attack
 * order is shadowing rather than engaging, and a roster that said "engaging" next to a
 * wing with no gun would be reporting a fight that is not going to happen.
 */
function orderText(w: World, id: ClassId, order: Order): string {
  switch (order.kind) {
    case 'move':
      return 'moving'
    case 'hold':
      return 'holding'
    case 'device':
      return 'releasing'
    case 'attack': {
      const verb = cls(id).weapon ? 'engaging' : 'shadowing'
      const target = w.squadrons.find((s) => s.id === order.sq)
      return target ? `${verb} ${target.name.toLowerCase()}` : verb
    }
  }
}

/*
 * Grouped by what the input is for, and complete. The three line version taught the
 * orders and left out the camera: drag to orbit, middle drag to pan and the wheel were
 * all bound and none of them were written down, which are the first three things a
 * commander reaches for once a fight converges into a knot a hundred pixels wide. The
 * two speed keys were missing for the same reason.
 */
const LEGEND = [
  '<b>click</b> select  <b>shift</b> add / altitude  <b>1-9 tab</b> squadron  <b>q</b> all',
  '<b>right click</b> order  <b>h</b> hold at cursor  <b>z x c</b> tight open wide  <b>e</b> arm device',
  '<b>wasd</b> or <b>middle drag</b> pan  <b>drag</b> look  <b>wheel</b> zoom',
  '<b>f</b> follow  <b>l</b> level  <b>g</b> gate down  <b>space</b> hold time  <b>[ ]</b> slower faster',
].join('<br>')

/**
 * The briefing. Mazer never explained a battle before it started, but a game has
 * to teach its own vocabulary somewhere, so the epigraph carries the tone and the
 * hint card carries the mechanic.
 */
export function briefingScreen(
  scenario: Scenario,
  index: number,
  all: Scenario[],
  unlocked: number,
  handlers: { start: () => void; pick: (index: number) => void },
): HTMLElement {
  const wrap = el('div', 'screen')
  const card = el('div', 'card')
  card.append(
    el('div', 'eyebrow', `battle ${index + 1} of ${all.length}`),
    el('h1', undefined, scenario.name),
    el('blockquote', undefined, scenario.epigraph),
  )
  for (const line of scenario.brief) card.append(el('p', undefined, line))
  if (scenario.teaches) card.append(el('div', 'teaches', scenario.teaches))

  const go = el('button', 'go', 'take command')
  go.addEventListener('click', handlers.start)
  card.append(go)

  // Battles already reached stay reachable. A campaign whose fifth battle can only
  // be seen by winning the first four again is a campaign nobody replays.
  const ladder = el('div', 'ladder')
  all.forEach((s, i) => {
    const open = i < unlocked
    const item = el('button', i === index ? 'here' : open ? undefined : 'locked', `${i + 1} ${s.name}`)
    item.disabled = !open || i === index
    item.addEventListener('click', () => handlers.pick(i))
    ladder.append(item)
  })
  wrap.append(card, ladder)
  // preventScroll, because focus pulls its element into view: on a short window that
  // scrolls the briefing down to its own button and opens the card on paragraph three.
  requestAnimationFrame(() => go.focus({ preventScroll: true }))
  return wrap
}

/**
 * The after action report. The numbers that matter are the ones the novel cares
 * about: whether the objective fell, and what it cost in hulls that were not
 * coming back.
 */
export function reportScreen(
  world: World,
  scenario: Scenario,
  next: Scenario | null,
  handlers: { again: () => void; next: () => void },
): HTMLElement {
  const won = world.outcome === 'won'
  const wrap = el('div', 'screen')
  const card = el('div', `card ${won ? 'won' : 'lost'}`)
  card.append(
    el('div', 'eyebrow', scenario.name),
    el('h1', undefined, won ? 'the volume is yours' : 'your fleet is gone'),
  )

  const s = world.stats
  const rows: [string, string][] = [
    ['duration', `${world.t.toFixed(0)}s`],
    ['hulls lost', `${s.blueLost} of ${countStart(world, 'blue')}`],
    ['hulls taken', `${s.redLost} of ${countStart(world, 'red')}`],
    ['shots fired', String(s.shots)],
  ]
  if (s.deviceKills > 0) rows.push(['unmade by cascade', String(s.deviceKills)])
  if (s.friendlyDeviceKills > 0) rows.push(['our own, by cascade', String(s.friendlyDeviceKills)])

  const table = el('dl', 'stats')
  for (const [k, v] of rows) table.append(el('dt', undefined, k), el('dd', undefined, v))
  card.append(table)

  const buttons = el('div', 'buttons')
  const again = el('button', undefined, won ? 'fight it again' : 'again')
  again.addEventListener('click', handlers.again)
  buttons.append(again)
  if (won && next) {
    const on = el('button', 'go', `next: ${next.name.toLowerCase()}`)
    on.addEventListener('click', handlers.next)
    buttons.append(on)
    requestAnimationFrame(() => on.focus({ preventScroll: true }))
  } else {
    requestAnimationFrame(() => again.focus({ preventScroll: true }))
  }
  card.append(buttons)
  wrap.append(card)
  return wrap
}

const countStart = (w: World, side: 'blue' | 'red'): number =>
  w.ships.filter((s) => s.side === side).length
