SECOND BRAIN GLOBE · DESIGN SPEC

WORLD
- Globe radius R = 300 world units. Everything below is in world units.
- Background: #000000 (pure black). A CSS radial-gradient (black) vignette darkens the edges.
- No glow anywhere: no bloom post-processing, no additive glow sprites. Nodes are solid
  shaded 3D spheres; the nucleus is a solid + wireframe tesseract. Nothing blooms.
- Camera home position: { x: 0, y: 150, z: 780 }, looking at origin.
- Controls: orbit, autoRotate on at speed 0.35, damping 0.05, minDistance 260, maxDistance 1500.

PALETTE
- Node palette (leaves, dust): #ffd166, #ffb454, #ff5d8f, #ff2d55, #c8b6ff, #e8ecff, #86d1ff
- Globe wire: #a9b0d6 at 0.14 opacity. Equator: #dfe4ff at 0.5. Radial fan: #9aa0c8 at 0.06.
- Core red: #ff3355. Wire cubes: #ffc9d4 / #ffdbe3. Frosted shells: #cabfd6. (No core glow.)
- Rings: #e0356b, #c22f5f, #93264a, #6e1f3d.
- Spoke links: rgba(214,219,245,0.40). Branch links: rgba(214,219,245,0.30).
- Tether links: rgba(255,109,138,0.35). Tether particles: #ffc2cf.
- Hub ball tint: the cluster's palette color lerped 20% toward warm ivory #fff3dd.

TESSERACT NUCLEUS (the core node's custom object; deliberately small, nucleus scale)
- Solid cube: 26 units/side, MeshLambertMaterial #ff3355 (shaded, not glowing).
- Wire cube A: 40/side, EdgesGeometry LineSegments, #ffc9d4, opacity 0.70.
- Wire cube B: 56/side, #ffdbe3, opacity 0.35.
- Frosted shells: cubes at 48, 68, 90 per side. MeshBasicMaterial #cabfd6, DoubleSide,
  depthWrite false, opacity 0.10 / 0.07 / 0.045. Each shell gets a random static base rotation.
- No core glow sprite (removed): the nucleus does not glow. The solid cube uses
  MeshLambertMaterial so it reads as a shaded 3D cube.
- The outermost shell (90) is 0.30 R. Do not exceed this. The nucleus must read small
  relative to the globe.
- Continuous rotation, radians/sec: the whole group (x .03, y .09, z .02) so every cube
  spins together about the sphere's center, plus each cube's own motion:
  solid (x .35, y .50), wireA (x -.22, z .30), wireB (y .16, x .10),
  shellA (y .12, x .05), shellB (z -.08, y -.05), shellC (x .04, z .03).

ORBITAL RINGS (thin crimson tori around the nucleus)
- Radii 115 / 150 / 205 / 250, tube thickness 1.2 / 1.0 / 0.9 / 0.8.
- Colors and opacities: #e0356b @ .75, #c22f5f @ .50, #93264a @ .40, #6e1f3d @ .30.
- Tilts: rotation.x = PI/2 + [0.16, -0.10, 0.24, -0.30], rotation.y = [0.4, -0.7, 1.4, 2.3].
- Group them; the group rotates around Y at 0.06 rad/s.

GRAPH DATA (12 clusters)
- Cluster names: Projects, People, Ideas, Research, Content, Code, Reading, Health,
  Finance, Travel, Journal, Learning.
- One core node: id "core", type "core", fixed at fx = fy = fz = 0.
- 12 hub nodes: type "hub", each with a weight in [0.9, 1.3]. Positions: fibonacci-sphere
  directions with jitter 0.22, at radius 0.45 R to 0.70 R from origin. Fixed via fx/fy/fz.
  (Pulled in from the shell so clusters have room to fan out and stay inside the globe.)
- Leaves: 16 to 30 per hub, type "leaf". val distribution: 70% val 1, 20% val 2, 10% val 5.
  Color: random from node palette.
- Branches: ~25% of leaves get one grandchild, type "branch", val 1.
- Links: kind "tether" (core to each hub), kind "spoke" (hub to leaf, per-link distance
  random 18 to 48), kind "branch" (leaf to grandchild, distance random 12 to 24).
- All randomness comes from a seeded RNG so layouts are reproducible.
- Containment: a radial-bound d3 force clamps every unpinned node's distance from origin
  to <= 0.95 R each tick, so no dot (and therefore no link) ever pokes outside the globe.

HUB BALLS (custom object; solid shaded 3D spheres, no glow)
- SphereGeometry radius 11 * weight, 24 x 24 segments.
- MeshLambertMaterial (lit by the graph's default lights), color = cluster color lerped
  20% toward ivory #fff3dd, transparent true so it can dim. No halo sprite.
- Hover or focus: ball scales to 1.25x, lerped, never snapped.

LEAVES (library-default spheres)
- nodeRelSize 4, nodeOpacity 0.9, nodeResolution 12. Sized by val, colored per node.

TETHERS AND ENERGY
- Tethers use linkCurvature 0.18 with a random linkCurveRotation in [0, 2*PI).
- linkDirectionalParticles 2 per tether, width 3.5, color #ffc2cf,
  speed random per link in [0.004, 0.008], random initial offset.
- Spokes and branches are straight, no particles.

ENVIRONMENT (added to graph.scene(), grouped under one "environment" THREE.Group)
- Latitude circles every 15 degrees from -75 to +75, 128 segments each.
- 12 meridian circles. One bright equator LineLoop at 160 segments.
- Radial fan: 144 line spokes at y = 0 from r = 65 out to r = 300 (the dense disc look).
- Inner dust: 500 points (normal blending, no glow), radius 80 to 295, size 4, palette dimmed 80%.
- Background stars: 300 points (normal blending), radius 400 to 950, size 5, dimmed 55%, opacity 0.5.
- Two "streams": 46 warm dots each (mix #ffb454 / #ffd166, size 8) scattered with jitter 9
  along a bezier arc hugging the shell at ~0.82 R.
- Year label "2026": canvas text sprite, letterspaced, rgba(232,236,255,0.92),
  positioned at (0, 340, 0), sprite scale roughly 140 x 35.

UI CHROME
- Top-left brand block: "SECOND BRAIN" (12px, 600 weight, 0.42em letterspacing, uppercase,
  #eef1ff) over "Interactive knowledge globe" (10px, 0.2em, #8b90ad).
- Bottom-center hint: "drag to rotate · scroll to zoom · click a hub" (10px, 0.22em, #6d7290).
- Hover tooltip via the library's nodeLabel, styled through the .scene-tooltip class:
  dark translucent chip, 1px rgba(255,120,150,0.35) border, uppercase, letterspaced.
- Focus panel, right side, vertically centered: cluster name, node count, orbit radius %,
  a thin gradient bar (#ff2d55 to #ffd166), and "click empty space to release".
  Translucent dark card, blur backdrop, fades in/out.

MOTION RULES
- All continuous motion (tesseract rotation, ring drift, hub breathing) runs in one
  requestAnimationFrame loop, independent of the force simulation.
- Hub breathing: scale multiplier 1 + 0.06 * sin(2t + phase), unique phase per hub.
- If prefers-reduced-motion: autoRotate off, particle speed 0, rotation speeds * 0.25.

POST-PROCESSING
- None. The scene renders straight to the canvas: no UnrealBloomPass, no glow.
  Black background, solid shaded nodes, plain wireframe globe.
