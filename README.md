# Command School

A real time fleet game in the spirit of the simulator battles Ender fights at
Command School. You command a volume of space from outside it, in wireframes and
points of light. You never touch a hull; you talk to squadron leaders, and they
fly.

It is also an experiment, which is what most of this document is about: how much
of a game Claude can design and build when the prompting is kept to a minimum.
The prompt asked for something in that spirit and said little else, and
everything downstream of it is Claude's, the five hull classes, the eight
missions, the ballistic gunnery, the interface, the harnesses that balanced it
and the write up below, built in Claude Code over two days. The only information
that reached the work from outside is two rounds of complaints from a person who
sat down and played it, and those two rounds cost more rework than everything the
harnesses turned up put together.

It plays in a browser at <https://jssblck.github.io/command-school/>, and it runs
locally the usual way:

```bash
npm install && npm run dev
```

Then open the address Vite prints. Progress through the campaign is kept in local
storage, and `?m=last-exam&seed=7` opens any battle by id at a chosen seed.

`npm run build` typechecks and writes a static `dist/`, which is the whole game:
there is no server behind it, so it hosts anywhere that serves files.
`.github/workflows/pages.yml` publishes that to GitHub Pages on every push to
main, and takes the path prefix a project page is served under from the
repository's own name, so nothing has to be set by hand except the source in the
repository's Pages settings, which has to be GitHub Actions rather than a branch.

## What you actually do

Orders are addressed to squadrons, not ships, and they take time to arrive. The
comm delay starts at four tenths of a second and reaches a second and a quarter
by the last mission, so late in the campaign you are commanding a fleet whose
present position you do not know. The formations, the gravity wells and the
sensor fog are all there to make that delay expensive.

| | |
|---|---|
| click / shift click | select a squadron, or add to the selection |
| right click | move to empty space, or attack the contact under the cursor |
| shift while ordering | set the order's altitude instead of its position |
| digits `1` to `9`, `tab`, `q` | select by roster number, cycle, or select everything |
| `z` `x` `c` | stance: tight packs the wing under one field, open splits the difference, wide clears every barrel |
| `h` | hold station at the cursor's point, or where the wing stands if the cursor is on a contact |
| `e` then click | arm the device and pick a target; right click stands it down |
| `f` `l` `g` | hold the selection centred, level the camera, or put the enemy's gate down |
| space, `[` `]` | pause, and halve or double the clock |

`wasd` carries the camera across the volume. A middle drag grabs the picture and
pulls it instead, so whatever was under the cursor stays under it, which is why
dragging right takes the camera the opposite way from holding `d`. A left drag
turns the camera to look somewhere else without moving it, and the wheel zooms.

## The volume

Five hull classes, each answering a different question rather than sitting on a
power curve. Needles cost a point each and out-turn anything that can shoot back;
lances hit thirteen times harder from twice the distance but only through a
narrow cone, so the shape a squadron holds decides how many of them can speak at
once; aegis hulls project a field that bites a fixed amount out of every bolt
crossing it, which makes them the answer to massed small arms and no answer at
all to artillery; keels are capitals that replace their own losses out of a
launch bay; eyes are unarmed and see nearly twice as far as anything else in the
fleet and close to three times as far as a needle.

Every bolt is a physical object. It leaves a muzzle, flies at its own speed, bends
in a well, and hits the first hull that crosses its path, whichever side that hull
is on; there is no to-hit roll anywhere in the game. What separates the guns is how
fast a mount can track. A needle crossing close sweeps a lance's sky faster than
the whole hull can turn, so the shells land where the needle was, while the same
needle charging straight in has no angular rate at all and eats a shell that
one-shots it. Thrust is coupled to facing the same way: a hull burns sideways at
about a third of its thrust, so a wing told to move somewhere turns its nose and
runs at full burn with its guns silent, while a wing on an attack or a hold keeps
its guns free and pays for the manoeuvring in thrust. That is the choice the game
keeps asking: run fast and silent, or fight and crawl. It also means the side
crossing open volume is the side that pays, so the back half of the campaign keeps
garrisons, wings that hold their line and make you come to them.

Planets and moons block fire but not sensors, so a world is cover from guns rather
than a way to disappear, and a well swallows any bolt that ploughs into it. Their
pull does nothing to a hull: thrust beats surface gravity by an order of magnitude
here, and a run past a planet with the well switched off bends
within a unit of the same run with it on. So a world is a wall to route around
rather than a current to ride, and what it costs is seconds. Squadrons steer wide
of a surface whatever they were told, holding fifty units clear at the closest
across every approach angle, so a planet in the lane will not kill the wing you
sent through it. What comes back is a curve that arrives late and off to one side,
which is why a move order draws a second line under it wherever the run departs
from the line you drew. A debris field or a ring blinds the squadron inside it and
wears its hulls down while it hides there, a thin ring at 0.6 a second and a dense
field at 1.0, which is half a minute of lurking for a needle before the rock has
killed it.
The dust you can see is the volume that does it: the drawn slab and the simulated
one are the same numbers, so a ring's clear hub is clear in both. The reference
grid sags into the wells because there is no floor in space and you need one to
judge depth at all.

The eight missions run from two flights of needles in an empty volume to a
homeworld behind three layers of fleet, which cannot be won by killing anything.
The device that ends that battle chains between hulls that are close together and
does not care whose hulls they are.

## Layout

`src/sim/` is the simulation: a deterministic fixed step at 1/60 with a seeded
RNG, and no three.js anywhere in it, which is what lets the harnesses run
thousands of battles in seconds. `src/render/` and `src/ui/` read simulation
state and never write it. Nothing in the scene is lit; every material is emissive
and additive, so the bloom pass is doing the work a lighting rig normally would.

`tools/` is everything that plays the game without a person. Three of them have
npm scripts because they run on every change: `balance` sweeps the campaign and
the class tables against the simulation directly, while `byhand` and `hands` fly
the missions through the real interface and so need `npm run dev` up and Edge
installed. The rest run under `npx tsx tools/<name>.ts`: `passive` plays the
campaign with blue never saying anything, `probe` and `debug` put a single duel
under a microscope a few seconds at a time, `exam` compares three plans for the
last mission, `layout` checks every deployment for hulls spawned into rock, and
`shoot` and `play` photograph the volume and the interface, and `pagescheck`
boots the production build the way Pages serves it, from a path prefix, since an
asset URL that misses that prefix fails silently into a black canvas. Anything
driving the browser reads the live page, so editing `src/` mid-run reloads it
underneath the harness and the run dies on a missing `window.cs`.

`npm run check` typechecks the whole project, harnesses included.

## Playtesting

Everything from here down is the log rather than the manual, and it is the part
worth reading if you are here for the experiment instead of for the game. The "I"
in it is Claude's, writing up its own playtesting between sessions, and the
outside hand it keeps mentioning is the person who played it. Which of those two
found what is the result. The harnesses caught a great deal, including a mission
that shipped impossible to win and a run of interface claims that were false, and
the one thing they could not catch is that the game had no tactics in it, because
a win rate reads the same whether a battle is decided by geometry or by dice.
That took somebody playing for five minutes and saying the fights resolve
themselves, which is what the last section is about.

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

None of that presses a key. `npm run byhand` plays the Last Exam through the
interface a person has to use: number keys to address the roster, right clicks to
give the orders, the comm delay in between, and the arming panel read out of
`controls.shot` before every release. It spends
the charge only when the panel promises the mission, meaning in reach, ending on
a skin, and nothing shy of the homeworld, and it re-reads the panel one last time
in the frame it clicks in, because the aim is live.

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
battle time it never counted, and the clock is what the section below is about. Closing from 120 to 80 to be sure of the shot costs six hulls, and
the wing then dies inside the comm delay with the charge still aboard, so the right
move is to release on the frame the range line goes green.

Every defect below came out of that pass, and not one of them moved a win rate,
because the simulation was right each time and only the account of it was wrong:

- The aim snapped onto your own wing whenever one crossed the cursor, so the
  panel promised the planet and the click put the charge in the fleet.
- The panel printed the enemy hulls a cascade would take and not the friendly
  ones, which on this mission is most of what the shot costs.
- Preview and shot each resolved the burst point from the aim, and the second
  resolve begins exactly on a skin, where the ray test cannot say which body it
  is touching: 7 of 12 geometries lost the body and burst in open space.
- A garrison wing drifting across a stationary cursor turned "the flash itself
  catches Hive" into a burst 47 out, in three runs of six.
- The objective line measured the aim and ignored the fuse, so a pixel 40 off the
  limb claimed the planet while the charge armed against hulls instead and
  tripped early on the escort.
- A courier that died inside the comm delay dropped the charge without a word,
  and the mission carries exactly one.
- The comm channel froze 16 seconds into every battle, because the HUD tracked
  the log by array index and the log is a 40 line ring whose length stops
  changing.

`tools/shoot.ts` and `tools/play.ts` drive the real game loop out of a headless
browser and write `shots/`, so a visual or interface change can be compared
against the frame before it at the same second of the same seed. Both need the
dev server up.

Reading those frames is what caught the balance of force bar. It was a flex item
sizing itself against the whole row, label included, and then shrinking to fit, so
a full fleet drew 143 pixels of a 132 pixel rule and every reading below that was
wrong by its own amount. A Shoal frame with a wing of twelve needles wiped, eleven
of twenty five points left, still showed a bar most of the way full. It is a grid
column now, and the percentage means what it says.

The soft wall came out of the same pass and took two goes. Every First Contact frame
carried a faint dead straight line the full height of the viewport, at the same screen
column eleven seconds apart, and nothing in the renderer draws a vertical. The wall is
three great circles at the edge of the theatre, one per principal plane, and a circle
seen edge-on projects to a line straight through the middle of the volume, which is the
opposite of what an edge marker is for. Dimming each circle by how face-on it is removes
that line and then loses the wall at the angle between the axes, where all three sit at
58 percent: orthogonal planes conserve the ink between them, but split three ways it comes
to 10 levels of contrast out of 765 a line, against 26 for a circle face-on. Neither
number is readable by eye, which is why the probe samples the frame along each circle's
own projected path. The fade runs on a square root now and the colour clears the bloom
threshold, so the worst angle reads 79 and the edge of a volume that shoves a hull back
at one and a half times its own thrust is findable from anywhere.

Measuring what those mostly empty frames actually hold caught the follow key doing less
than the legend claimed. Projecting every live hull every two seconds, the whole of the
opening skirmish fits in a box 116 pixels across by T+4, and Deep Well never gets above
four percent of the viewport at any point in the battle, because two fleets 500 apart
converge into a melee 80 across and the opening camera is composed for the 500. `f` was a
one-shot recentring, so a wing it centred sat 117 pixels back out two seconds later and
stayed around a hundred for the rest of the fight. It holds a wing now, inside a pixel of
the middle of the screen for as long as you leave it, and lets go when you pan, when you
press it again, or when the wing is wiped, saying so in the channel when the camera goes
quiet on its own. Distance stays yours: a camera that zooms itself during a fight takes
away the comparison a player reads speed and range out of.

Overwhelm's clock came down from 145 seconds to 90, because the mission is only a fight
for about 45 of them. All thirty six of red's needles die between 39 and 47 seconds, and
what is left is eight lances at speed thirty and four screens chasing a fleet that flies
at fifty eight, so under the winning plan one seed killed nothing at all on either side
between T+60 and T+145. The clock was never what decided whether that plan wins, since it
is not wiped at any clock length out to 200 seconds. What the clock decides is how long the
plans that plant themselves last, and those die at a median of 78 seconds standing still
and 86 behind Anvil, so 90 separates the three plans 12, 1 and 5 where 145 separated them
12, 1 and 1 and spent the difference on a procession. The generic commander still dies at
a mean of 57 seconds, so the shorter clock did not hand it a mission it has never won. The
header now also prints the seconds left instead of only the seconds spent, because a clock
that counts up under an objective line naming the target asked the player to subtract at
every glance, on the one mission where that difference is the score. The same measurement
turned up that the winning fleet is pressed against the soft wall from T+20 onward, and that
is left alone, since nothing can englobe you at the boundary and spending the whole volume
to buy that is what the brief is teaching.

Reading the eight briefs in campaign order turned up a rule the simulation does not have.
The second mission's brief said nothing sees through a moon while the seventh mission's hint
card said sensors read straight through a planet, and the card was right: an eye 400 units
from a needle with a 130 radius planet exactly between them cannot shoot it and holds it on
sensors the whole time. Rock is cover from guns and dust is what blinds you, which is why
the eye class arrives with the debris belt in Shoal rather than with the moon two missions
earlier. Nothing in play ever leaned on the false version, since a fleet spread across a
volume always has some hull holding a clear line and no contact in either rock mission was
blocked from all of them at once over 75 samples, so the brief is what changed rather than
the sensor model.

The Bay Doors was then flown by hand through the real click path, since the harness only
proves the simulation allows the flanking plan and clicks are what prove a player can issue
it. An order resolves where the cursor's ray meets a plane through the wing being ordered,
horizontal by default and facing the camera under shift, so one click cannot leave its plane
and the route has to be said in two orders. Which order they go in decides the mission.
Flanking on the horizontal plane and then dropping under the ring closes both bays at T+72
with nine of twenty three hulls left, four clicks in all, and the two waypoints land 17 and
2 units from the points aimed at. Descending first is the natural reading of going under
their guns, and it is a click that slides the fleet sideways along the start line making no
progress toward the bays: a bay rolls out another needle every seven seconds, so that run
reached the flank at T+57 with one hull left. The place it wants is also off the frame at
the opening camera, at pixel -306,1036, so it cannot be clicked at all until the wheel comes
back three notches. What changed off this was the legend, which taught the orders and the
stances and left the camera out: drag to orbit, middle drag to pan, the wheel and the two
speed keys were all bound and none of them were written down, and they are the first things
a commander reaches for when the place they want is not on screen.

A frame from the last exam caught the roster narrating orders for wings that no longer
exist. Four of the five rows are wiped by T+22 on that mission, and each was still reporting
a manoeuvre: HOPPER read 0/16 and engaging drift. A wiped wing keeps its number and its
name, because renumbering the roster under the player's fingers is how an order meant for
the courier reaches the artillery instead, but the row says lost now.

Rings with nothing inside them in that same frame turned out to be two separate faults. Most
were ghosts, the mark for a contact the fleet remembers and can no longer see, which is a
claim about where a hull was and must never read as a hull. The claim was false. A ghost is
dropped when the hull died where the fleet could see it, and that test ran after the sensor
sets were rebuilt, which is after dead hulls have been dropped from them, so it could never
be true: every kill the player watched left a marker sitting on the wreck until it aged out.
Sampled every simulated second over six runs of each mission, that put more rings on the plot
than the honest ones on seven of the eight missions, First Contact drawing 1.7 wrecks against
no real contacts at all and Overwhelm 8.8 against 6.5 with as many as 35 up at once. Deaths
are settled against the previous pass now, before the rebuild. What survives is the case the
marker is for: a hull that died after drifting out of contact stays on the plot, since nobody
in the fleet knows it is gone.

The second fault was an aegis field. A screen draws one shell around the squadron rather than
one per hull, and the shell was centred on the sim's centroid, which averages over every live
hull whether the viewer has detected it or not. With two of a screen's three hulls dark that
pulls the shell toward the two nobody has contact on, which draws a hoop around empty space
and quietly reports where they are. It happens on three to five per cent of the frames a
screen is visible for, worst case 21 units, about a quarter of the field radius. The shell
follows the hulls in view now.

Looking for a third of the same kind turned up a candidate and the measurement said to leave
it. A wing under an attack order steers by its target's true position with no sensor test, so
in principle it can chase something the fleet has lost, which is the one place the plot is
honest and the steering is not. In practice it is 0 to 7 percent of the attack orders in play
and for your own wings it is 0.1 of a wing per frame at worst, because a squadron close enough
to shoot is well inside its own sensors: the standoff a class keeps is a fraction of how far it
can see. A pursuit rule that fires that rarely is a mechanism bought against nothing, and what
it would actually reach is Shoal, the one mission whose dust makes losing contact routine and
so the one mission it would quietly retune.

The pressed Overwhelm frame stacks three large circles around one knot of hulls, and working
out which was which took a probe rather than an eye, since all three are round and dim and two
of them are blue. It enumerates every round mark the renderer would draw at that second with
its world radius and its radius in pixels, and two of the marks turned out to be one circle. An
aegis field is 78 units plus six tenths of the formation's spread, which comes to 88 through 114
across every stance and hull count, and an aegis gun reaches a flat 100, so selecting a screen
drew where protection ends and where the guns stop over each other in the same dim blue, 4
pixels apart in that frame. A screen gets no reach circle now. The field is the mark worth
keeping, since it is the reason the class is in the fleet, while the gun is a two point pinprick
nobody positions a screen to use. Swept over the campaign with the whole fleet selected, no
other pair of marks lands within a dozen pixels of each other in both centre and radius, and
the sweep does report this pair when the rule is taken back out, which is how I know it is
looking. The three marks left in that frame read as three different things: a planet's geodesic
shell, our own field, and theirs in red.

The comm channel in the same frame had the identical fault in colour rather than in geometry.
Nine lines are on screen, the oldest five at half and a quarter opacity, and attrition is
flushed on a 1.5 second timer, so a brawl posts a loss line every second and a half and
crowds out everything else: arming the courier on the Last Exam at T+26 put HAMILTON armed on
a channel with four loss lines above it and four below, the whole visible nine, every one of
them the same orange. Every alert the game posts is about the device, without exception, from
armed and out of reach by N through a courier lost with the charge still aboard to a world
unmade, so the tone is called device now and takes the violet of the arming panel and the
cascade preview, which is a hue the interface has already taught. Hue is also the right axis
for it, since eight lines of one colour is precisely what destroys a difference in brightness.

The selection ring sent me looking at the wrong mark and turned up a better one on the way. A
ring is drawn at the radius the stance and the hull count say the formation occupies, which
makes it a claim about where the hulls are computed from what the wing was told rather than
from where it went, so I sampled each of our wings once a simulated second and counted the
hulls sitting outside their own ring. It encloses the whole wing on 96 to 100 per cent of
frames on six of the eight missions, and the two it misses are the two with a well in them:
Deep Well stretches the entire formation rather than dropping one straggler, the hull halfway
down the pack sitting at 0.78 of the drawn radius against 0.38 to 0.48 everywhere else. That is
the mark under-claiming in the mission whose whole lesson is that gravity pulls a formation
apart, which is the harmless direction, since every hull is drawn as its own glyph whatever the
ring does. The formula stays.

What the sweep turned up instead is that the stance was not travelling. `sq.stance = stance`
was assigned straight into the world by the key handler, while move, hold, attack and the
device all wait out the comm delay in `pending`, so the one rule the game teaches on the first
mission had a single exception and it was the one a player's fingers find. The channel was
already calling it an order, posting HOPPER tight in the blue of a signal sent, and no
acknowledgement ever came back because there was nothing left to acknowledge. Delaying it had
to be safe before it could be right, so I held every stance change for the comm lag from
outside the sim over 14 seeds a mission: the campaign moved both ways and by little, Under the
Aegis 79 to 100 per cent, Shoal 86 down to 79, The Bay Doors 0 up to 14, which is a wash and
says tightening under fire was never worth hulls to begin with. A signal is now a whole
instruction, a task and the shape to carry it out in, which is how the commander had been
writing it all along: all eight of its stance assignments sat on the line after an `issueOrder`
to the same wing, and each became an argument to that call. The roster prints the shape inside
the ellipsis rather than ahead of it, because a mark in front reads as a wing already flying
what it has only just been asked for. Saying a second thing while the first is still in the
channel holds the whole instruction back to the later arrival, so talking twice costs time and
pressing tight before clicking a destination lands as one order instead of throwing the shape
away. What the signal carries is a copy of that order rather than the order itself, which the
first version got wrong in a way worth keeping a note of: the lift that pushes a destination
clear of a planet scales with the formation, so sending the live object let a wider stance edit
the order the wing was flying at that moment, and a wing holding station 52 units above a skin
slid 34 units outward on the keypress with nothing yet delivered. Nothing changes a wing from
the keyboard any more without crossing the channel: the
assignment in `resolveOrders` is the only stance write left in the project, the two scripted
harnesses had to stop cheating with it as well, and the Last Exam still takes every one of its
eight seeds by hand while the sweep's four plans win at 100, 67, 100 and 83 per cent over a
duel table that still reads needles over lances, lances over keels, keels over needles.

Writing Deep Well's plan turned up a larger one. The mission's lesson was a red line
that warned when a move order ended in rock, and no such run exists: `liftClear`
pushes a destination out of any solid and `avoidBodies` steers hulls around what they
close on, both deliberately, since under a second of comm lag an accidental click
would otherwise kill a wing. A sweep over 63 geometries built to fly straight into a
130 radius planet, in three classes and three stances, never fired the warning once:
the nearest any hull came to the skin was 51 units, and gravity moved a capital's path
by one unit in a hundred. The brief promised a death the simulation declines to deal,
and the whole render path for the warning was unreachable code.

The fix was to forecast what the rock does do. A move order now measures how far the
run departs from the straight line it describes, and draws the curve when that gap
passes 25 units: open volume reads 4 at worst and a planet in the lane reads 100 and
up, so the second line appears exactly when the order and the run disagree. It costs
a needle wing three seconds and a keel wing nine, and those seconds are spent in the
open in front of artillery, which is what the 1-of-12 straight run dies of. One number
replaced the crash flag, the brief now says what the volume actually does, and the
mission plays the same as it always did.

Neither harness looks at frame time, so a probe of its own measures it. Under a software
rasteriser the whole campaign presents at one rate, 104ms a frame on the opening two
flights and 110ms on the Last Exam with 122 hulls up, so the cost is fixed in the post
pass rather than paid per hull. The simulation is where hull count shows, and it is
nowhere near mattering: a step costs 39us at 17 hulls and 107us at 124, six tenths of one
percent of a 60fps frame for physics, steering, sensors and gunnery. The outliers are all
the collector, four to ten pauses of 8 to 26ms in a battle, and replaying the same seed
moves them to different battle times, which is how you know they are not the step. A
dropped frame a few times a minute, under a comm delay of a second, is not something a
commander can feel.

Both hand harnesses used to disagree with themselves, and the disagreement was the clock
rather than the game. The loop steps the battle off real frames, so every round trip out to
the browser spends simulated seconds nobody chose: a camera swing, a projection and a click
cost about a second between them, and a finishing loop that reads the board and issues six
orders can burn ten. Under the Aegis took every seed on four passes and then none of them on
the fifth with nothing in the game changed, which I had written down as the mission being
tight. Both harnesses hold the clock now, on `hold=1`, the same pause a player takes on the
space bar, and buy the time back a third of a second at a time: 0.35 simulated seconds are
charged for one key or one click, putting a hand at about three actions a second, which is what
the real-time version had been spending per gesture without measuring it. Charging nothing is
the other way to get this wrong and it is the worse one, since a loop that re-tasks six wings
on one timestamp is playing an instant no hand can play. Held and charged, a plan is the same
battle every run: two passes of byhand over eight seeds print the same line for every seed,
and two three-seed passes of the other seven are identical top to bottom.

Holding the clock turned up a stall in the call the harnesses move it with. It ran
`Math.round(seconds / DT)` steps, and the clock accumulates float error, so a harness that
has run to 2.0 is really at 1.9999999999999978 and asks for the remaining sliver: rounded to
nearest that is no steps at all, the mark is never reached, and the run sits there until
something else moves the world. It takes the ceiling now, because overshooting by one step
costs nothing and answering a request for time with no time is a hang.

`npm run byhand` is the exam. `npm run hands` is the other seven missions, played the same
way: number keys to address the roster, right clicks to give the orders, the comm delay in
between, fog on, and nothing issuing blue's orders. Each plan is the reading a player takes
off the briefing card rather than the best line I could find, which is the point of it. What
it measures is whether a card can be read and flown, not whether a mission can be solved.

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

Six findings out of that pass, and not one of them was a balance number. The first was mine
rather than the game's. Five of the six plans said everything they had to say in the first
twenty seconds and then stopped talking, so a battle that was going well decayed into two
hulls against one with the clock running, which reads as a stalemate in the simulation and is
really a commander who walked away. A finishing loop that keeps naming whatever of theirs is
nearest and on the plot was worth five wins in eighteen, and took Shoal from none in three to
two.

The second was nearly a defect report against the win condition. An eye is the fastest hull in
the game and carries no gun, so a lone surviving scout is mathematically uncatchable: 74
against a needle's 58 and a lance's 30, and on Shoal seed 1000 that left the board unchanged
from T+38 to T+202, both sides holding an attack order on a wing they could not reach, the run
ending on the harness clock rather than on anything that happened. Which reads as an argument
for scoring only the hulls that shoot, and it is the wrong fix, since it calls a mission over
with enemy hulls alive and drawn on the plot. What was missing is a decision rather than a
rule: a commander whose fleet cannot take a hull off the board flies what is left out of the
theatre. The AI does that now, and the soft wall that shoves everything else back holds the
door open for a wing that has been told to leave, so crossing it removes the hull with no
wreck and no line on the tally, because what the after-action card counts is what the fleet
shot down and something that ran is something nobody caught. Stripped to its scout, red is out
of the volume in 11 seconds on every seed. Only the AI does this, and the asymmetry is the
point: blue's commander is the player, who may have a reason to stay.

The third was a real gap in the view. Selecting a wing draws how far its guns carry, which
covered every class except the one bought for reach, since a scout has no gun and so drew
nothing at all. Shoal is built on the two numbers that circle holds, because a scout sees 470
and the longest gun in the volume reaches 240, and the two mistakes cost the same fleet: too
close and the scout dies, too far and it is watching nothing while the fleet chases marks
half a minute old. The circle is on the plot now, and it shrinks with the sensors when the
wing is inside dust, because a ring that stayed at 470 in the belt would be the interface
promising something the simulation has no intention of delivering.

Reading the scout's own numbers turned up the fourth. A scout ordered onto a contact held 240
off it, under a line of code commented "outside anyone's weapons envelope", which is exactly
the range of a lance. Centre to centre against a formation with depth that is not outside the
envelope, it is on the lip of it, so the order that means go and watch them was walking the
fleet's eyesight into artillery. It clears the longest gun in the game by 40 percent now,
taken from the class table rather than written down twice, and the comm line says shadow
rather than engage for a wing with nothing to engage with. The campaign sweep reads the same
number for number either side of the change, since the AI was already keeping its scouts
alive. The player was the one being told 240 was safe.

The fifth was the plan and not the mission. Shoal read worst of the six by hand, and the plan I
had written for it held the fleet high on our own ground and made red climb the belt to reach
us, which is a line I invented; the card talks about dust that blinds both sides and about
keeping a scout outside it. Flown the card's way instead, over the belt and onto their side of
it with the eye out wide and their lances named first, the same fleet reads 9 of 12 headless
against the 7 of 12 the high line takes, and it finishes in 64 seconds against 88, all of that
difference being seconds the fleet spends on station in front of fourteen needles that arrive
together. There was nothing wrong with the mission. I had been playing a different one.

The sixth was a rule I wrote and then took back out, which is the only way I found out what it
cost. A fleet can lose its last gun with hulls still flying, and by hand that spent 36 seconds
of two scouts at speed 74 outrunning one lance at 30, so I scored a disarmed fleet as beaten
and moved on. Measuring the change found the case against it: on one Shoal seed in twelve,
blue's last gun died with red down to a single lance on 4 of its 88 hull, and 24 seconds later
that lance drifted into the belt, which finished it. The dust kills, so a hull that can be led
into it is a hull that can still be killed, and towing a lance into a debris field at twice its
speed is a play worth leaving room for. What the commander is actually missing
there is the news, since every wing still reads as present and under orders: the channel now
says "nothing left that shoots" the moment it becomes true, and the battle stays open.

Shoal's terrain turned out to be paying for its balance. A hull in dust took 3.5 a second
scaled by how far the field blinds it, which is 2.4 a second in the thick of the belt and
kills a 32 hull needle in thirteen seconds, and the card promises hulls die in there slowly.
At that price nothing light can lurk in cover, so the concealment the mission is built around
was unusable by either side and the rock was deciding the battle instead: six runs with both
sides on AI billed red 271 hull to the belt against blue's 139, a third of red's fleet gone
before contact and never once a decision either commander made, because the side crossing the
volume is the side that pays. Keeping stations out of the dust was the first attempt and it
moved red's bill from 271 to 275, since the time goes on crossing and fighting rather than
parking, so the price is what had to change. At 1.5 a needle lasts half a minute in the worst
dust, which is a real cost for a real ambush, and it moved Shoal from 83 to 67 percent AI
against AI and the scripted run at the homeworld from 23 of 24 to 20 of 24.

Charging what a hull can actually survive in there put the fight back on the fleets, and the
fleets were 21 points of guns against 26, red holding four lances to blue's three. Both swarms
trade off almost exactly, so what the mission came down to was three lances against four,
which is not a fight: blue won one hand run in nine and lost the other eight with red's
artillery two or three hulls up. Red's fourth lance came off. Fourteen needles and three
lances against twelve and three puts their swarm two hulls up with the artillery even, and the
second eye is what blue has instead of the extra needle. The sweep reads 75 percent with the
lance gone, against 67 with it in and 83 back when the belt was doing the balancing.

With the artillery even, the second half of Shoal is a seeing contest rather than a shooting
one. Three lances against three, both reaching 240, so whoever is drawn first
dies, and they win that from inside the rock, where a 470 sensor reads 150 and a lance's own
240 reads 77: their guns cross the belt unseen and open at a range the fleet has nothing drawn
to answer. On seed 1000 that was the whole loss, THORN climbing out at T+29 and all three of
ours wrecked by T+41 without firing. What beats it is the scout, forward and low, in the gap
between our guns and the rock. Their artillery has to come inside 240 of our lances to shoot
them, the approach passes underneath that post, and 150 is enough to catch it there. The wing
is inside their reach while it does that, which is the price, and a volley spent on two points
of scout is a volley not spent on a lance either way.

The finishing loop was reading the board every eight seconds, which is slower than the guns
it is answering. A lance volleys every 2.6 seconds and one shell takes a needle off the board,
so on Shoal three of ours died holding station while their artillery climbed out of the belt
at T+29 and the order to shoot back went in at T+38, three volleys after it was drawn. Four
seconds now.

Overwhelm ends in a retreat rather than in that loop, which is the difference between holding
the 90 seconds and not. Naming whatever of theirs is nearest turns a fleet outnumbered two to
one around to fight the pursuit, and that is a fleet being counted: it died at 69 seconds on
two seeds in three, with the notes filling up with wings waiting out twenty seconds on
artillery they were never going to see, since a fleet opening the range never has their guns
on screen. Clicking at fog for twenty seconds is not a reading of that card. The card says
keep opening the range, so the hand does: every wing 300 further from the part of their mass
it can see, restated every six seconds, while the arming panel is read every two. Those are
different jobs. A retreat restated more often than that never gets anywhere, and the release
is a window a few seconds wide: on the cadence that first put the courier behind the fleet as
a rearguard, the pursuit reached it and killed it between one look at the panel and the next,
with the charge still aboard and the fleet 475 clear.

That retreat presses the fleet against the soft wall, where two faults were waiting. A
destination outside the theatre is how the simulation hears withdraw, and hulls that cross
under that order are gone with no wreck and no line on the tally, which is a decision the AI
makes with its survivors and would cost a player hulls on a click they had no way to read.
A click past the edge lands at the edge now, clamped where the cursor is traced rather than at
the order, so the drawn cross and the forecast run go where the wing will. Clamped exactly to
the boundary the fleet still walked out of the door, because the test for a withdrawal is a
strict comparison and a point scaled onto the boundary lands a hair outside about half the
time: fourteen hulls gone between T+13 and T+19, no wrecks, no tally lines, nothing of red's
touched. Two units inside holds. What the clamp looks like from inside the retreat is the run
of notes under every Overwhelm seed, orders landing 63 to 291 from the point clicked, which is
a fleet at the edge of a 940 unit volume being told to go 300 further out.

The charge is the other half of that plan, and it took two releases inside our own fleet to
learn to read the panel. The hand fired at range 45 on a panel reading 13 of theirs and 24 of
ours, and the cascade took 11 and 24, which was the entire fleet, because a retreat that sends
every wing to one point packs it into a ball ten units across. Then it fired at 53 on 4 of
theirs and none of ours and again took 24 of ours, and that second one is the interesting
failure, because nothing on the panel was wrong: the count is a snapshot of who is standing in
the burst, the release takes a comm delay plus the bolt's run out at 150 to arrive, and in that
second and a half the fleet flew into it. So the test is none of ours in the count and nobody
of the fleet on a course into the burst, read off the same velocities the simulation
integrates. With that test in place the charge is spendable. The seed flown before it won with
the charge still aboard, 13 of 25 alive and red still holding 17 of 50, and all five seeds fire
it now, red coming down to between 7 and 11 with 14 to 21 of ours alive at the bell.

A forecast printed without its outcome beside it is a promise reported as a result, so the
harness measures every release against its own panel four seconds later, which is the bolt out
at 150 plus fourteen generations on a 0.13 fuse. Five releases at 57 to 112 out, each on a
panel reading none of ours, took 2 to 20 of theirs and 1 or 2 of ours. Where that cost fell is
what the panel's zero is worth: the courier lost both its hulls on all five, one to the burst
and one to whatever was shooting at it, and the fleet behind it lost nothing. The zero is a
statement about the fleet and says nothing about the wing carrying the charge, which is the
trade the card is asking about, since it says outright that whoever releases it is standing in
the burst.

Getting to that rule went through the panel's standoff line first, and that attempt is what
turned up the panel's own bad line. It warned whenever our nearest hull stood inside 455, which
is how far the cascade walks if every generation of it finds a hull, and a retreat cannot buy
455 of clear space without leaving the courier where red's artillery reaches it, since a lance
throws 240 and takes an eye off the board with one shell. Flown against that line the charge
went unspent and the courier died carrying it on all five seeds.
The five good releases each read a standoff of 275 to 341 against the same 455, so the panel
shouted in capitals on every one of them and each cost the fleet nothing, because the chain
had run out of hulls 63 to 129 out. A warning that is on for every shot is a warning the
player stops reading. The preview returns the reach the chain gets through the crowd actually
in front of the cursor now, and the panel warns on that. The AI still weighs the weapon's
bound, since there it is a graded risk rather than a warning and a hull at 341 contributes a
quarter of one.

The chain is drawn in the volume as well, which is how that line became visible: the
screenshot had the capitals in the panel next to a chain that stopped, in plain sight, two
hundred units short of our nearest wing. Seven numbers a hop, from and to and the odds it is
still walking when it arrives, each hop fading by the 0.86 a generation compounded. A 455
bubble would have been the easier drawing and the wrong one, since most of that sphere is
empty space the cascade cannot cross, and the empty two hundred units between the burst and
the fleet is the thing the commander is deciding on.

The Bay Doors was the last mission no hand had flown, and it takes 4 of 5 seeds now. The route
is the one the scripted plan found, two waypoints wide of their artillery and in at the bays
from behind, and the card says it in three parts: six lances cover the straight line to both
bays, every heavy hull in the volume is slow, and the fleet does not have to sweep anything.
What the hand had to learn was the ending rather than the route. The finishing loop names what
the objective names before anything else now, because naming whatever of theirs is nearest and
armed is a commander fighting the wrong battle here: a bay rolls out another needle every
seven seconds, so the nearest armed thing on the plot is always fresh and the guns spend the
whole battle on the escort without ever reaching the two keels the mission is scored on.
Reading the objective's own target list costs nothing on the six missions that do not name a
wing, where the list is empty and the rule falls back to nearest, and on this one it is the
difference between closing both bays around T+83 with eleven to nineteen of twenty three hulls
left and never closing either.

The seed it loses says only that the fleet was gone before the end, so the timeline is the whole
account of how. On the pass this was written from that was seed 9109, and it reads like this.
Nine lances fly at 30 while the needles and the screen fly at 58, so one click to a single
waypoint puts the fast wings on station at the bays ten seconds ahead of the guns, and the guns
cross the last 350 units alone: on seed 9109 their artillery was standing where that leg passed
and LOVELACE arrived with two of its nine hulls. Two guns closed one bay and stalled on the
second while COIL WING rebuilt from one needle to six, blue's last gun died at T+91, and the
scout held the station it had been given until red's needles reached it at T+115. That is the
disarmed rule working rather than a defect. The channel says the guns are gone and the battle
stays open, and the scout that could have outrun everything red owns sat where it was posted,
because leaving is an order and nobody gave it.

Under the Aegis was taking 2 of 5 in the same pass, and the field was over the wrong wing.
The card says their screens make our small arms worthless, and the half it left out is that
ours does the same to theirs: a field takes 2.4 out of every bolt that crosses it, a needle's
shot is 2.6 and a lance's shell is 34. So the screen belongs over the sixteen needles, where it
turns their whole swarm into a rounding error, and over our artillery it buys nothing, since 34
minus 2.4 is still three shells to a lance. Flown with the field over the guns, the needles
fought their swarm in the open and went from sixteen to six in the ten seconds after contact.

The cadence was the half that looked like the fault. An order names a place and never a wing to
follow, so keeping our screen over a moving brawl is something the commander has to keep
saying, and the loop was opening at T+42 on a fourteen second cadence: a screen that arrives
twenty seconds after the fight and then holds station on where the fight was. On three of five
seeds it was dead at its deployment station before the loop said anything to it at all.
Tightening the cadence to six seconds with the field still over the guns moved 2 of 5 to 3 of
5. Putting the field over the needles and starting the loop at contact takes all five, and seed
1000 goes from three hulls kept to fourteen of twenty four.

None of that arithmetic was anywhere in the game, which is the same class of fault as a warning
that fires on every shot: a mission decided by a number the player has no way to read. The card
carries a third paragraph now, saying that the bite is the same for every bolt that crosses the
field, all of a needle's shot and a rounding error off a shell, and that your artillery is not
what needs the cover. All eight cards still reach from their title to their begin button at
every window height from 900 down to 420, which is the test that matters for a fixed panel:
one line too many is a button off the bottom of the screen with nothing to click.

## What the first outside hand found

Every measurement above was taken by the same hand that wrote the interface, and a harness
written by that hand asks the questions the interface already answers. The first hand that was not
mine got four complaints out of the first few minutes, and each one turned out to be a
mechanism rather than a matter of taste.

Clicking to select did nothing at all. The same button selects and orbits, so a press has to
be read as one or the other, and the line was five pixels of travel: a hand that slid six
between press and release got a camera nudge and no selection, with nothing on screen to say
why. It is twelve pixels now, inside the slip of a firm click and under any drag meant as one,
and erring in this direction costs a camera nudge that the next drag just repeats.
Selection survives 0, 3, 6, 9 and 12 pixels of slip, and 14 and 20 still read as drags.

The camera turned like a turntable rather than like a head. An orbit rig walks the camera
around a fixed centre, so the one part of the picture that holds still is whatever the cursor
started on, and at command range that reads as the theatre being spun. The drag holds the
position and pushes the centre around it instead, so 120 pixels turns the view about thirty
degrees and moves the camera nothing at all. A followed wing writes that centre every frame,
so the same drag still swings around whatever the camera has been told to hold.

The pan was not so much reversed as sideways in both axes. It slid the centre along the pair
of axes the volume hangs off, which do not turn with yaw, so a 30 pixel horizontal drag moved
the picture seven pixels while a vertical one moved it twenty four pixels sideways, and which
axis did what depended on where the camera happened to be standing. Along the camera's own
right and up it is a grab: one pixel of picture per pixel of hand on each axis, with the
conversion derived from the frustum, since the hand tuned constant it replaced was 18 percent
fast and a grab that slips accumulates its error for as long as the drag lasts. Panning is
also what you do continuously while reading a board, and a drag occupies the hand that selects
and orders, so wasd carries the picture at 600 pixels a second
and nothing needs the middle button any more.

The reticle sat off the pointer for two reasons that added up. The cursor was resolved against
the camera as it was and then drawn after the camera eased, which left the cross thirteen
pixels behind the pointer for as long as a drag lasted. And a selected wing snapped the aim
onto itself: nudging a wing means pointing just off it, so its own hulls are inside the pick
radius, and the cross jumped as much as fifty pixels back onto the centroid it was already
standing on, while describing an order to stay put. Camera first, then the step, then the
drawing, and no wing snaps to itself. The cross now reads zero pixels of error at 0, 20, 40
and 60 pixels off a selected hull, and zero on every frame of an orbit.

That last fix cost Under the Aegis two seeds in eight, and the reason is worth writing down.
The pick reads a friendly wing at forty pixels against an enemy at twenty, on purpose, because
picking the wrong friendly selects it and a second click undoes that, while picking the wrong
enemy is an order at comm delay that cannot be recalled. Aegis is the mission where our own
screen flies over their swarm, so the harness's click on their centroid landed on us and went
out as a move order, and the self snap had been quietly turning that mis-click into stay put,
which kept the wing in the brawl by accident. The harness had been clicking blind, checking
only that something was under the cursor. It now walks their drawn hulls until the cursor
reads as the wing being sent at, which is the slide a player makes when the comm line names
the wrong wing.

Aegis is eight of eight again, and the shape of the win changed. Every seed closes between 48
and 59 seconds where the old build ran 44 to 88, and the seeds that used to keep the most hulls
keep well under that now: 1000 at fourteen of twenty four, 6284 at thirteen and 2273 at eleven
finish with six, nine and seven, while the other five move by three hulls or less either way.
The orders that used to go astray were parking wings that now get committed, and a screen flown
into their swarm on purpose loses ships doing it. The two seeds that fell over while the
harness clicked blind, 2273 and 7777, lost the whole fleet rather than a few hulls, which is
what a plan looks like when half of it never went out. Three seeds over all seven missions is
21 of 21 with the walking click in, including the Shoal seed that had been the standing loss.

Two bindings moved to make room for the pan: every wing at once is `q` and the device arms on
`e`, and the legend says so. All three hand harnesses had to be told, and until they were they
panned the camera instead of arming the charge, which is how the pass immediately after the
input work lost most of its device missions and sent me looking for a fault in the sim that
was not there.

## What the shot album could not show

The shot fixture takes thirty two frames across the campaign at fixed seeds and fixed cameras,
which is what makes a visual change comparable against the frame before it. Two of the faults
below were in the fixture rather than in the game, and fixing those is what surfaced the rest.

The Shoal's debris belt was burying our own fleet. Grains are points with their pixel size
clamped at nine, and at the range a contact frame is shot from a good part of the belt sat on
that clamp, so a few thousand of them summed additively to hull brightness and our own needles
inside the field were the same grey as rock. Four variants over the Shoal's contact frame and
the Keel's ring deployment, one dimmer, one finer, one both, settled it on size alone, since
cutting brightness either did less or erased the field. Ring grains run 0.9 to 2.5 units now
against 1.4 to 4.2 and field grains 1.3 to 4.2 against 2.2 to 7, which costs the belt nothing a
player reads off it: its edge and its banded gaps come from where the dust is rather than from
how fat each piece of it is drawn. The Last Exam's deployment went from two grey smears to red's
clusters visible inside the field, both ring bands apart, and the reference grid reading through
the dust for depth.

Then the album turned out to be omniscient. Drawing red's whole fleet was implied by the same
flag that skips the briefing and hands blue to its autopilot, so all thirty two frames were of a
volume no player will ever be looking at. Red's dispositions are most of what a commander does
not know, and a fixture that photographs them cannot tell whether the fog reads: First Contact
opened its shot with six of red's hulls plainly on screen beside a THEIRS bar reading nearly
zero, which is the console and the volume disagreeing about the same fact. Fog is its own switch
now. The deployment shot also lost its camera, which had been backing off until every live hull
was in frame, a framing that under fog stands well back to hold hulls that are not drawn and
pushes our own fleet into a corner. A fixture that poses its own opening shot can never catch
the game's opening being wrong, so that shot photographs whatever camera the game left, and
First Contact's deployment is now ten legible needles, a moon, an empty volume and an empty
enemy bar. Photographing the real opening is also the first check of it: across all eight
missions it holds every one of our hulls on screen, the fleet spanning 227 to 731 pixels of a
1600 by 900 frame with its wings up to 786 apart, so nothing has to be found before it can be
given an order.

The comm channel in those frames was spending its nine lines on the same sentence. An order to
several wings posts one acknowledgement per wing, so three wings moving together wrote three
identical lines and the next order pushed something else off the top. A repeat counts up on the
line already there now, x3 beside it, with the clock moving to the latest saying of it so the
timestamp column stays in order.

No frame in the album holds a stale ghost, so photographing one took a probe that walks a
mission four seconds at a time and stops where blue is holding a wing it can no longer see. At
T+31 on the Shoal it holds three hulls of THORN and one of VEIL with nothing in sensor range at
all, and that frame is why the mark was never worth photographing: one small hollow point of
light per remembered hull, colourless, with no line dropped to the reference plane. From across
the theatre a dozen of those are a grey smudge that says nothing about how the wing was
arranged, and from inside they are faint rings floating at a depth the picture never gives, in
the one mission whose card promises a player can tell a stale contact from a live hull.

A ghost is a claim about the past rather than a thing in the volume, so it is drawn where the
player's own annotations are drawn, one mark per wing instead of one per hull: a three axis tick
at the centre of what is remembered, the dashed drop line every other mark in the interface
carries, and a ring at the spread the wing was last holding, drawn only when that spread comes
out wider than the tick itself. Floored on screen instead, the ring drew a hoop around a single
remembered hull, claiming a spread nobody ever saw, and two wings remembered in the same place
came out as one mark with a decoration. Age reaches the mark on a floor rather than on a
straight ramp, since drawn straight it went unreadable about ten seconds into a fourteen second
memory, which is the console dropping a contact the fleet still holds. The Shoal's card
describes the tick and the ring, and the drawing this replaced was the last thing using the
hollow branch of the core shader, so both went.

One frame turned out to be cheap, which is worth knowing before anything above gets blamed for
a stutter. The harness browser draws in software so its milliseconds mean nothing, but the work
submitted per frame is the same on any machine, and the Last Exam, the heaviest board in the
campaign with 122 hulls up and two dust belts drawn, submits 72 draw calls, 3900 triangles, 85
thousand points and 87 thousand line segments. The other seven missions run 54 to 66 calls.
Hulls, tracers, sparks and annotations are all pooled and batched, so a hull count moves what is
in the buffers rather than the number of calls, and what a slow machine would run short of is
fill rate for the additive points and the bloom chain rather than anything geometric.

The four things that felt wrong in the first play session are checked as numbers now, since they
were reported before the sim and the renderer were rebuilt around them. Clicking a hull selects
the wing it flies in, a left drag turns the camera through 0.8 radians and moves it 0.000 units,
and the order cursor lands 0.00 pixels from the mouse on both the flat plane and the vertical
one shift resolves against. The two pans carry the camera in exactly opposite directions, which
is right, since a drag moves the picture and a key moves the camera, and the only thing wrong
was the line above claiming the two gestures did the same thing.

## The dice came out of the gunnery

The same outside hand came back with a harder complaint: ships sit where they are pointed,
fights resolve themselves, and the first three missions fell without a meaningful order given.
All of that was one fault wearing three coats. Gunnery was a to-hit formula, an accuracy
number against an evasion weight, so nothing a hull did between volleys mattered: not its
vector, not its facing, not whether it was crossing or charging. Movement was decoupled from
facing because a gun that rolls dice gives geometry nothing to pay for. And a battle with no
geometry has no tactics, which makes passivity as good as command. `tools/passive.ts` pins
that last part as a floor now, red thinking and blue silent over eight seeds a mission: 8 of 8
on First Contact, which is the tutorial teaching that their commander is slow, and 0 of 8
everywhere else.

Every bolt is a physical object now, and the dice are gone entirely. A bolt leaves a muzzle,
flies at its own speed, bends in a well, and a swept segment test hits the first hull that
crosses its path, friend or enemy. What a mount is limited by is tracking: each weapon has a
traverse rate, the aim trails a target whose angular rate exceeds it, and dispersion scatters
the rest, so a miss is a place a shell actually went rather than a die that came up short. A
needle crossing close beats a lance's twelve degrees a second of traverse by simply being
fast and near; the same needle charging straight in has no angular rate and eats the shell.
Thrust is coupled to facing the same way, a hull burning sideways at about a third of its
straight-ahead thrust, and the orders split along it: a move order is a nose-first run at
full burn with the guns silent, an attack or a hold fights with the nose free and pays for
manoeuvring in thrust. Wings under fire weave, needles on an attack circle
their target instead of parking, and a wing whose gun outranges its target's now keeps
station just outside the answer, which is the give-ground rule the commander used to need
deleted from `ai.ts` entirely: the standoff does it inside the attack order, without the
half-minute nose swings that a separate retreat order cost a battery that turns at 3.75
seconds per about-face.

The first thing the new gunnery did was shoot itself. Every class duel came back a
mutual-suicide race, and the timeline probe said why in one line: 287 shots, 287 hits on the
shooter's own side. A bolt spawns 1.32 units ahead of its hull and a needle's hit radius is
4.4, so under swept collision every ship fired into its own face. A bolt carries its
shooter's id now and the sweep ignores that one hull, which is the physical claim that a
muzzle sits outside the hull it is bolted to. Ring formations then shot across their own
circle at anything beyond it, so a bolt also lives exactly as long as its flight to the aim
point plus a beat, and a battery holds any shell whose lane a friendly is standing in closer
than the target.

The class triangle survived the rebuild, and it is geometry now rather than assertion:
needles take lances 100 to 0 because the orbit out-turns a 12 degree mount, lances take
keels 100 to 0 because 240 outranges 130, keels take needles 88 to 8 because a capital's
ring of 55 degree turrets tracks most of what a needle can fly, and every mirror sits
between 46 and 58 percent. Getting there cost three class changes worth writing down. The
lance's sensor went from 185 to 275, because a gun that reaches 240 on a hull that sees 185
marched inside its own artillery advantage before knowing there was a war, and under
ballistics that walk is the duel lost on approach. The aegis gun became a real flak turret,
damage 5 on a 0.85 cycle at 140 degrees a second of traverse, the one mount in the fleet
that out-tracks an orbiting needle, so a screen is now itself the threat to the swarm it
blunts while still unable to answer artillery, and the screen table reads 63 percent
against a swarm where eight guns without one read 0. And the needle's standoff moved out to
six tenths of its range, because the ring's far side was flying through its own wing's fire.

Ballistics hand the volume to the defender, and the campaign had been built on red
attacking. The side crossing open volume arrives nose-on with no angular rate, which is the
easy tracking solution, so a red that marched its whole order of battle at a silent blue
handed over the first three missions for free. Five scenarios now garrison their key wings,
guards that keep their deployment order instead of joining the sweep, and the campaign
sweep reads 100, 100, 75, 100, 83, 58, 0 and 8 percent for the generic commander, the
middle of the campaign winnable by fighting and the last two by nothing but their intended
solutions. The scripted plans all hold: Deep Well 12 of 12 keeping 68 percent, The Bay
Doors 11 of 12 closing 23 of 24 bays, Overwhelm 12 of 12 keeping 58 percent with the
charge spent every run, the Last Exam 20 of 24.

The retreat surfaced a verb the interface could not say. The plan that holds Overwhelm
falls back on hold orders posted 300 behind the fleet, a fighting withdrawal, guns free and
thrust taxed, and the interface offered hold only where a wing already stands: rewritten
onto the orders a player could actually click, the same plan died twelve runs of twelve
with the fleet never firing, because a retreat on move orders is a retreat flown silent.
`h` reads the cursor now, posting the selection at the point under it when it is empty
space and stopping in place when it is not, the legend says hold at cursor, and Overwhelm
by hand holds all three seeds again, one of them at 24 hulls of 25 with the charge taking
18 of theirs.

Stances changed meaning under a physical bolt, and the cards that taught them were lies in
the new model. Tight used to concentrate fire; now it packs a wing into one artillery
bracket and stands its hulls in each other's firing lanes, which for a battery is
self-silencing, while wide clears every barrel and makes a bracket buy one hull at most.
Tight keeps exactly one virtue, packing a squadron under a single aegis field. The mission
plans in both hand harnesses were re-read accordingly, and the readings that survived the
old model died measurably under this one: Deep Well flown straight onto the route was wiped
by T+40 on every seed until the plan learned to break the sortie on a standing line first,
and Shoal's needles posted 200 forward of their guns traded twelve for eight until the plan
learned to attack with everything together, the same shape the generic commander wins with.

The Last Exam by hand now reads six of eight, releasing between 96 and 112 out with three
to seven of ten hulls aboard, and both losses are couriers shot down on the approach rather
than releases that went wrong: the terminal leg crosses a garrison whose shells arrive
where the wing will be, and a wing that shadows the courier at gun range never gives the
tracking model a reason to miss. The launch beat was re-swept for the new model, 14 to 18
seconds the plateau at 21 and 20 of 24 with a cliff on the late side where the old curve
was gentle, and the escort autopilot is now briefed the way the winning scripted commander
is, all the way forward and no wide flanks, which is what keeps the corridor's needle
screens fighting the escort instead of pacing the courier. The other seven missions flown
off their cards take 21 of 21 seeds, and the finishing loop learned the one new thing a
garrison demands: when nothing is drawn and nothing is remembered, the fleet walks up the
corridor it was invaded from, a leg at a time so the needles never cross an unseen
battery's envelope alone, because a garrison under fog is an enemy that standing still
will never show you.
