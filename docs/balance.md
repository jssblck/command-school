# How the fleet is balanced

Balance here comes off harnesses rather than off a feel for it, because the
commander doing the tuning is also the one writing the missions and will believe
whatever it just built. Every number below is printed by a command in this
repository, and the ones in this file were last re-run against the build the
README describes.

## The harnesses

`tools/` is everything that plays the game without a person. Three of them have
npm scripts because they run on every change: `balance` sweeps the campaign and
the class tables against the simulation directly, while `byhand` and `hands` fly
the missions through the real interface and so need `npm run dev` up and Edge
installed. The rest run under `npx tsx tools/<name>.ts`: `passive` plays the
campaign with blue never saying anything, `probe` and `debug` put a single duel
under a microscope a few seconds at a time, `exam` compares three plans for the
last mission, `layout` checks every deployment for hulls spawned into rock,
`shoot` and `play` photograph the volume and the interface, `campaign` plays the
screens around the battles rather than a battle, meaning which of the eight are
open, what a win writes down and where a reload lands, and `pagescheck` boots the
production build the way Pages serves it, from a path prefix, since an asset URL
that misses that prefix fails silently into a black canvas. Anything
driving the browser reads the live page, so editing `src/` mid-run reloads it
underneath the harness and the run dies on a missing `window.cs`.

## The campaign sweep

The whole tuning surface is one command. It runs the campaign sweep with both
sides on AI, the equal points class duels, the screen value comparison, and
scripted plans for the four missions a generic commander cannot reason its way
through.

```bash
npm run balance
```

That commander takes the first two missions every time, holds 75 to 100 percent
through the middle of the campaign, drops to 58 on The Bay Doors, and loses the
last two nearly outright: none of twelve on Overwhelm and one in twelve on the
Last Exam. It is a weak measure of whether a mission is fair, because it plays
every mission the same way, by pointing squadrons at whatever is nearest and
trading hulls, and the scripted plans are what tell a mission that resists that
apart from a mission that is simply impossible. Meet their sortie on your own
line, then go over the top of the planet and mass on their artillery, and Deep
Well falls in twelve runs of twelve with 68 percent of the fleet left. Give
ground on posts from your own centre of mass and turn the guns on the pursuit and
Overwhelm holds all 90 seconds in twelve runs of twelve with 58 percent alive.
Swing wide and come at the bays from behind their artillery and The Bay Doors
falls in eleven runs of twelve, closing 23 of the 24 bays. Send the fleet in,
hold the courier back while the escort crosses, then walk it up behind them and
the Last Exam falls in 20 runs of 24.

Deep Well used to be the cheapest illustration of what those plans are for, when
the generic rate read 8 percent and the number alone could not say whether the
mission was working or impossible. Under ballistic gunnery it reads 75, and the
rise is the new model's own arithmetic: the side crossing open volume is the side
that pays, red's swarm now does the crossing while its artillery garrisons, and a
commander too dull to fly a route still gets to shoot at hulls arriving nose-on.
What the plan buys over that is deliberateness at both ends, breaking the sortie
on a standing line before flying anywhere and only then routing around the rock
onto the guns, and it is worth 25 points of win rate and more than twice the
fleet kept at the bell, 68 percent against 29.

The Bay Doors is the case for keeping the plans, because it was in fact impossible
and shipped that way. Four plans over twelve seeds each all read 0 percent, and
the traces said why rather than that the dice were bad: a red lance does 34 and a
needle has 32, so the six lances holding over the ring one-shot anything small
crossing the open middle, and an aegis field bites 2.4 out of a bolt that size.
The fleet was fourteen needles and six lances, which made a third of its points
food and left it too few guns to chew through 1400 units of keel. The best of
forty eight runs got one keel to 156 and no run ever closed a bay. Ten needles,
nine lances and three screens fixed it without touching the defence, and under
ballistic gunnery the flank wins eleven of twelve with 71 percent of the fleet
left. The generic commander reads 58 percent on the same mission now rather than
zero, so the plan's edge has thinned to a third of the runs and most of the fleet:
the defence garrisons its overwatch instead of marching it out, and a commander
that blunders into the middle is punished by fewer guns than used to come and
find it.

Those numbers are the reason to keep the harness rather than a reason to trust
it. A win rate can hide anything: the campaign sweep read exactly the same before
and after the discovery that unmaking the homeworld with your last hulls was
being scored as a defeat, because the AI never got a charge onto the planet in
the first place and so never met the bug. Only the scripted plan met it, and only
because it won often enough for thirteen stolen wins to look wrong.

## The class table

The same command duels the classes at equal points, 24 points a side and 24
trials a pairing, which is where the triangle the fleet is built on has to show
up as geometry rather than as an assertion.

|            | needle | lance | keel |
|------------|--------|-------|------|
| **needle** |    58% |  100% |   8% |
| **lance**  |     0% |   46% | 100% |
| **keel**   |    88% |    0% |  58% |

Read as: the row class wins this often against the column class. Needles take
lances because an orbit out-turns a 12 degree mount, lances take keels because
240 outranges 130, and keels take needles because a capital's ring of 55 degree
turrets tracks most of what a needle can fly. Every mirror sits between 46 and 58
percent, which is what says a mirror is being decided by the seed rather than by
something asymmetric in the table.

Aegis is the one class that cannot win a duel, since it carries a token gun and
its points are spent on somebody else's survival, so it is measured by what a
mixed fleet does with one. At the same 24 points, eight guns without a screen
take 0 percent against a swarm and 46 against artillery, while six guns and a
screen take 63 and 67.

## The floor

A game where passivity plays as well as command has no tactics in it, and a win
rate cannot see that, so the floor is measured directly. `npx tsx
tools/passive.ts` gives red a thinking commander and leaves blue's wings on their
opening orders over eight seeds a mission. Blue silent takes First Contact 8 of
8, which is the tutorial teaching that their commander is slow, and 0 of 8 on
every mission after it.

## The exam by hand

None of that presses a key. `npm run byhand` plays the Last Exam through the
interface a person has to use: number keys to address the roster, right clicks to
give the orders, the comm delay in between, and the arming panel read out of
`controls.shot` before every release. It spends the charge only when the panel
promises the mission, meaning in reach, ending on a skin, and nothing shy of the
homeworld, and it re-reads the panel one last time in the frame it clicks in,
because the aim is live.

```bash
npm run byhand          # eight seeds and a tally
npm run byhand -- 2091  # one seed, verbose, writes shots/
```

Flown that way it takes six of the eight seeds, releasing between 96 and 112 out
with three to seven of the courier's ten hulls aboard, and the two seeds it loses
are couriers killed on the way in rather than releases that went wrong, which is
the mission's new price: under ballistic gunnery the terminal leg crosses a
garrison that shoots where you will be. The tally used to read eight of eight on
the old model, and before that six or seven failing on different seeds each time,
which I had written down as the mission being tight; it was the harness spending
battle time it never counted, and [the log](log.md) has the account of that.
Closing from 120 to 80 to be sure of the shot costs six hulls, and the wing then
dies inside the comm delay with the charge still aboard, so the right move is to
release on the frame the range line goes green.

## The other seven by hand

`npm run hands` flies the other seven the same way: number keys to address the roster, right
clicks to give the orders, the comm delay in between, fog on, and nothing issuing blue's
orders. Each plan is the reading a player takes off the briefing card rather than the best
line I could find, which is the point of it. What it measures is whether a card can be read
and flown, not whether a mission can be solved.

```bash
npm run hands                      # three seeds, seven missions, a line each
TRACE=shoal npm run hands -- 1000  # one mission, with a timeline every four seconds
```

Flown that way it takes 21 of 21, every one of the seven missions on all three seeds. Three
seeds cannot separate a plan that wins 60 percent of the time from one that wins 75, so the
scripted headless plans are where a plan gets compared. What this harness is good for is the
part they cannot check, which is whether the card can be read, clicked and flown at all, and
it reports that in the notes under each seed rather than in the number. The last pass printed
five of them: two wings that died between the moment the plan read the board and the moment
it clicked, which reads as nothing being selected to send at THORN at T+44, two waits on a
bay wing nobody had seen yet at T+78, and one Overwhelm order landing 206 units from the
cross that was drawn, which is the soft wall holding a retreat that asked to go outside the
theatre. All five sat under seeds the plan went on to win, so what they measure is the cost
of reading a board over a comm delay rather than anything about the mission.
