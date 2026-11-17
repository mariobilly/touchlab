import noise from './glsl/noise.glsl?raw'
import color from './glsl/color.glsl?raw'
import common from './glsl/common.glsl?raw'

/** GLSL helper libraries. Prepend to a fragment shader: `${GLSL.all}` or pick pieces. */
export const GLSL = { noise, color, common, all: `${common}\n${color}\n${noise}\n` }
