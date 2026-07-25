# Command School

A real time fleet game in the spirit of the simulator battles Ender fights at
Command School. You command a volume of space from outside it, in wireframes and
points of light. You never touch a hull; you talk to squadron leaders, and they
fly.

It is also an experiment: how much of a game Claude can design and build when the
prompting is kept to a minimum. The prompt asked for something in that spirit and
said little else, and everything downstream of it is Claude's, the five hull
classes, the eight missions, the ballistic gunnery, the interface, the harnesses
that balanced it and the documents under `docs/`, built in Claude Code over two
days. The only information that reached the work from outside is two rounds of
complaints from a person who sat down and played it, and those two rounds cost
more rework than everything the harnesses turned up put together.

It plays in a browser at <https://jssblck.github.io/command-school/>, and it runs
locally the usual way:

```bash
npm install && npm run dev
```

Then open the address Vite prints. Progress through the campaign is kept in local
storage, and `?m=last-exam&seed=7` opens any battle by id at a chosen seed.

`npm run build` typechecks and writes a static `dist/`, which is the whole game:
there is no server behind it, so it hosts anywhere that serves files.
`.github/workflows/pages.yml` publishes that to Pages on every push to main.

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

`npm run check` typechecks the whole project, harnesses included, and `tools/` is
everything that plays the game without a person.

## The rest of it

Two documents under `docs/`, because they have a different reader than this one.

[docs/balance.md](docs/balance.md) is how the fleet is balanced: what each
harness measures, what the campaign sweep and the class duels currently read, and
why a win rate on its own cannot tell a hard mission from an impossible one.

[docs/log.md](docs/log.md) is the development log, which is the part worth
reading if you are here for the experiment rather than for the game. It is what
each pass of playtesting found, in the order it was found, from an arming panel
that promised the planet and put the charge in our own fleet to the complaint
that took the dice out of the gunnery.
