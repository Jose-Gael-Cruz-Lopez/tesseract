SECOND BRAIN GLOBE · DESIGN SPEC

WORLD
- Globe radius R = 300 world units. Everything below is in world units.
- Background: #060310. A CSS radial-gradient vignette overlay darkens the viewport edges.
- Camera home position: { x: 0, y: 150, z: 780 }, looking at origin.
- Controls: orbit, autoRotate on at speed 0.35, damping 0.05, minDistance 260, maxDistance 1500.

PALETTE
- Node palette (leaves, dust): #ffd166, #ffb454, #ff5d8f, #ff2d55, #c8b6ff, #e8ecff, #86d1ff
- Globe wire: #a9b0d6 at 0.14 opacity. Equator: #dfe4ff at 0.5. Radial fan: #9aa0c8 at 0.06.
- Core red: #ff3355. Core glow: #ff4d70. Wire cubes: #ffc9d4 / #ffdbe3. Frosted shells: #cabfd6.
- Rings: #e0356b, #c22f5f, #93264a, #6e1f3d.
- Spoke links: rgba(214,219,245,0.40). Branch links: rgba(214,219,245,0.30).
- Tether links: rgba(255,109,138,0.35). Tether particles: #ffc2cf.
- Hub ball tint: the cluster's palette color lerped 55% toward warm ivory #fff3dd.

TESSERACT NUCLEUS (the core node's custom object; deliberately small, nucleus scale)
- Solid cube: 26 units/side, MeshBasicMaterial #ff3355.
- Wire cube A: 40/side, EdgesGeometry LineSegments, #ffc9d4, opacity 0.70.
- Wire cube B: 56/side, #ffdbe3, opacity 0.35.
- Frosted shells: cubes at 48, 68, 90 per side. MeshBasicMaterial #cabfd6, DoubleSide,
  depthWrite false, opacity 0.10 / 0.07 / 0.045. Each shell gets a random static base rotation.
- Core glow: additive sprite (soft radial canvas texture), color #ff4d70, scale 130, opacity ~0.45.
- The outermost shell (90) is 0.30 R. Do not exceed this. The nucleus must read small
  relative to the globe.
- Continuous rotation, radians/sec: solid (x .35, y .50), wireA (x -.22, z .30),
  wireB (y .16, x .10), shellA (y .12, x .05), shellB (z -.08, y -.05), shellC (x .04, z .03).
- Glow opacity pulse: 0.36 + 0.12 * sin(1.7t).

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
  directions with jitter 0.22, at radius 0.55 R to 0.90 R from origin. Fixed via fx/fy/fz.
- Leaves: 16 to 30 per hub, type "leaf". val distribution: 70% val 1, 20% val 2, 10% val 5.
  Color: random from node palette.
- Branches: ~25% of leaves get one grandchild, type "branch", val 1.
- Links: kind "tether" (core to each hub), kind "spoke" (hub to leaf, per-link distance
  random 25 to 65), kind "branch" (leaf to grandchild, distance random 15 to 30).
- All randomness comes from a seeded RNG so layouts are reproducible.

HUB BALLS (custom object; these must read as solid spheres, not sprites)
- SphereGeometry radius 11 * weight, 24 x 24 segments.
- MeshBasicMaterial, color = cluster tint (see palette), transparent true so it can dim.
- Halo: additive soft sprite behind the ball, scale 3.2 * ball radius, opacity 0.55.
- Hover or focus: ball scales to 1.25x, lerped, never snapped.

LEAVES (library-default spheres)
- nodeRelSize 4, nodeOpacity 0.9, nodeResolution 12. Sized by val, colored per node.

