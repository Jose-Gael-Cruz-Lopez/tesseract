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
