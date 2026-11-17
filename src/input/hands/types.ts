export interface Vec2 { x: number; y: number }

/**
 * One tracked hand, in normalized OUTPUT coordinates: x 0..1 left→right, y 0..1 top→bottom,
 * already mirrored / mapped for the active scene.
 */
export interface Hand {
  /** Stable slot id (0 or 1). */
  id: number
  /** 1 while tracked, fades to 0 over ~150 ms after the hand is lost. */
  presence: number
  /** 21 landmarks × (x, y, z). z is MediaPipe's relative depth (negative = toward camera). */
  lm: Float32Array
  palm: Vec2
  index: Vec2
  thumb: Vec2
  /** 0..1 continuous pinch amount. */
  pinch: number
  pinching: boolean
  /** 0..1 how open the hand is (extended fingers). */
  openness: number
  open: boolean
  fist: boolean
  point: boolean
  /** Hand rotation in radians: 0 = fingers up, positive = clockwise on screen. */
  roll: number
  /** Hand size relative to the output height (depth proxy, ~0.1–0.4). */
  size: number
  /** Palm velocity in output units per second. */
  vel: Vec2
}

export type GestureType = 'pinchStart' | 'pinchEnd' | 'open' | 'fist' | 'point'
export interface GestureEvent { hand: number; type: GestureType; x: number; y: number }

export interface HandsState {
  hands: Hand[]
  /** Gesture events that happened since the last frame. */
  events: GestureEvent[]
  /** Where control comes from right now. */
  mode: 'camera' | 'mouse' | 'none'
  /** Distance between the two palms (0 when fewer than two hands). */
  twoDist: number
}

export const EMPTY_HANDS: HandsState = { hands: [], events: [], mode: 'none', twoDist: 0 }

/** MediaPipe landmark indices. */
export const LM = {
  WRIST: 0, THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
} as const

export const HAND_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
]
