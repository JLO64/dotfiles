// credits: https://github.com/unkn0wncode
void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord.xy / iResolution.xy;

    // Create seamless gradient animation
    float speed = 0.1;
    float gradientFactor = (uv.x + uv.y) / 2.0;

    // Use smoothstep and multiple sin waves for smoother transition
    float t = sin(iTime * speed) * 0.5 + 0.5;
    gradientFactor = smoothstep(0.0, 1.0, gradientFactor);

    // Define color palette
    vec3 color1 = vec3(0.06, 0.01, 0.09);  // Extra dark indigo
    vec3 color2 = vec3(0.08, 0.02, 0.14);  // Extra dark violet
    vec3 color3 = vec3(0.07, 0.01, 0.11);  // Extra dark purple
    vec3 color4 = vec3(0.05, 0.05, 0.05);  // Very dark gray
    vec3 color5 = vec3(0.0, 0.0, 0.0);     // Pure black

    // Pseudo-random transitions
    float transitionDuration = 4.0;
    float timeSegment = floor(iTime / transitionDuration);
    float timeInSegment = fract(iTime / transitionDuration);
    float smoothFade = smoothstep(0.0, 1.0, timeInSegment);

    // Random hashes for color selection
    float hash1 = fract(sin(timeSegment * 12.9898) * 43758.5453);
    float hash2 = fract(sin(timeSegment * 78.233 + 1.0) * 43758.5453);
    float hash3 = fract(sin((timeSegment + 1.0) * 12.9898) * 43758.5453);
    float hash4 = fract(sin((timeSegment + 1.0) * 78.233 + 1.0) * 43758.5453);

    // Select colors based on hash values (0-1 range split into 5 segments)
    vec3 currentColor1 = mix(mix(mix(color1, color2, step(0.2, hash1)), mix(color3, color4, step(0.6, hash1)), step(0.4, hash1)), color5, step(0.8, hash1));
    vec3 nextColor1 = mix(mix(mix(color1, color2, step(0.2, hash3)), mix(color3, color4, step(0.6, hash3)), step(0.4, hash3)), color5, step(0.8, hash3));
    vec3 currentColor2 = mix(mix(mix(color1, color2, step(0.2, hash2)), mix(color3, color4, step(0.6, hash2)), step(0.4, hash2)), color5, step(0.8, hash2));
    vec3 nextColor2 = mix(mix(mix(color1, color2, step(0.2, hash4)), mix(color3, color4, step(0.6, hash4)), step(0.4, hash4)), color5, step(0.8, hash4));

    // Fade between randomly selected colors
    vec3 gradientStartColor = mix(currentColor1, nextColor1, smoothFade);
    vec3 gradientEndColor = mix(currentColor2, nextColor2, smoothFade);

    vec3 gradientColor = mix(gradientStartColor, gradientEndColor, gradientFactor);

    vec4 terminalColor = texture(iChannel0, uv);
    float mask = 1.0 - step(0.5, dot(terminalColor.rgb, vec3(1.0)));
    vec3 blendedColor = mix(terminalColor.rgb, gradientColor, mask);

    fragColor = vec4(blendedColor, terminalColor.a);
}
