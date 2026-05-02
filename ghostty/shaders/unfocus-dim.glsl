// ============================================================================
// GHOSTTY UNFOCUSED TEXT-DIM SHADER
// ============================================================================
// When the window loses focus, text/foreground content fades toward the
// background color while the background itself remains unchanged.
// This avoids the flicker caused by full-screen dimming during tab switches.
//
// Early exits when focused for zero performance impact.
// ============================================================================

// ----- Configuration -----
const float DIM_STRENGTH = 0.55;   // How much text fades toward background (0=none, 1=invisible)
const float COLOR_THRESHOLD = 0.04; // Minimum color distance to consider a pixel "foreground"

// ------------------------------------------------------

// Sample the background color from the four corners of the screen.
// Corners are almost always pure background in a terminal.
vec3 sampleBackground(vec2 uv, vec2 resolution) {
    vec2 offset = 2.0 / resolution; // 2px from edges to avoid artifacts
    vec3 tl = texture(iChannel0, vec2(offset.x, 1.0 - offset.y)).rgb;
    vec3 tr = texture(iChannel0, vec2(1.0 - offset.x, 1.0 - offset.y)).rgb;
    vec3 bl = texture(iChannel0, vec2(offset.x, offset.y)).rgb;
    vec3 br = texture(iChannel0, vec2(1.0 - offset.x, offset.y)).rgb;
    return (tl + tr + bl + br) * 0.25;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    // Focused: pass through unchanged
    if (iFocus == 1) {
        fragColor = texture(iChannel0, uv);
        return;
    }

    // Unfocused: fade text/foreground toward the background color
    vec4 original = texture(iChannel0, uv);
    vec3 bg = sampleBackground(uv, iResolution.xy);

    // How different is this pixel from the background?
    // Pixels near the background color stay put; text pixels get pulled toward bg.
    float dist = distance(original.rgb, bg);
    float isForeground = smoothstep(COLOR_THRESHOLD, COLOR_THRESHOLD + 0.08, dist);

    vec3 dimmed = mix(original.rgb, bg, DIM_STRENGTH * isForeground);

    fragColor = vec4(dimmed, original.a);
}
