#version 400
layout (location = 0) out vec4 fragColor;

in vec3 v_position_EC;
in vec3 v_normal_EC;
in vec2 v_tex_coord;

uniform sampler2D u_albedoMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_metallicRoughnessMap;
uniform sampler2D u_emissiveMap;

// lights
uniform int u_light_count;

struct LIGHT {
    vec4 position;
    vec3 color;
};

#define NUMBER_OF_LIGHTS_SUPPORTED 13
uniform LIGHT u_light[NUMBER_OF_LIGHTS_SUPPORTED];

uniform vec3 u_camPos;

const float PI = 3.14159265359;
// ----------------------------------------------------------------------------
// Easy trick to get tangent-normals to world-space to keep PBR code simplified.
// Don't worry if you don't get what's going on; you generally want to do normal 
// mapping the usual way for performance anways; I do plan make a note of this 
// technique somewhere later in the normal mapping tutorial.
vec3 getNormalFromMap()
{
    vec3 tangentNormal = texture(u_normalMap, v_tex_coord).xyz * 2.0 - 1.0;
    tangentNormal.z *= -1;  // for normal map based in directX

    vec3 Q1  = dFdx(v_position_EC);
    vec3 Q2  = dFdy(v_position_EC);
    vec2 st1 = dFdx(v_tex_coord);
    vec2 st2 = dFdy(v_tex_coord);

    vec3 N   = normalize(v_normal_EC);
    vec3 T  = normalize(Q1*st2.t - Q2*st1.t);
    vec3 B  = -normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);

    return normalize(TBN * tangentNormal);
}
// ----------------------------------------------------------------------------
float DistributionGGX(vec3 N, vec3 H, float roughness)
{
    float a = roughness*roughness;
    float a2 = a*a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH*NdotH;

    float nom   = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;

    return nom / denom;
}
// ----------------------------------------------------------------------------
float GeometrySchlickGGX(float NdotV, float roughness)
{
    float r = (roughness + 1.0);
    float k = (r*r) / 8.0;

    float nom   = NdotV;
    float denom = NdotV * (1.0 - k) + k;

    return nom / denom;
}
// ----------------------------------------------------------------------------
float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness)
{
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2 = GeometrySchlickGGX(NdotV, roughness);
    float ggx1 = GeometrySchlickGGX(NdotL, roughness);

    return ggx1 * ggx2;
}
// ----------------------------------------------------------------------------
vec3 fresnelSchlick(float cosTheta, vec3 F0)
{
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
// ----------------------------------------------------------------------------
void main()
{		
    vec3 albedo     = pow(texture(u_albedoMap, v_tex_coord).rgb, vec3(2.2));
    float metallic  = texture(u_metallicRoughnessMap, v_tex_coord).b;
    float roughness = texture(u_metallicRoughnessMap, v_tex_coord).g;
    float ao        = texture(u_metallicRoughnessMap, v_tex_coord).r;
    vec3  emissive  = texture(u_emissiveMap, v_tex_coord).rgb;

    vec3 N = getNormalFromMap();
    //vec3 N = v_normal_EC;
    vec3 V = normalize(u_camPos - v_position_EC);

    // calculate reflectance at normal incidence; if dia-electric (like plastic) use F0 
    // of 0.04 and if it's a metal, use the albedo color as F0 (metallic workflow)    
    vec3 F0 = vec3(0.04); 
    F0 = mix(F0, albedo, metallic);

    // reflectance equation  
    vec3 Lo = vec3(0.0);
    for(int i = 0; i < NUMBER_OF_LIGHTS_SUPPORTED; ++i) 
    {
        // calculate per-light radiance
        vec3 L = normalize(u_light[i].position.xyz - v_position_EC);
        vec3 H = normalize(V + L);
        float distance = length(u_light[i].position.xyz - v_position_EC);
        float attenuation = 1.0;   // for directional light
        //vec3 radiance = u_light[i].color * attenuation;
        vec3 radiance = u_light[i].color * attenuation * vec3(4.5);   //day heuristic : light intensity

        // Cook-Torrance BRDF
        float NDF = DistributionGGX(N, H, roughness);   
        float G   = GeometrySmith(N, V, L, roughness);      
        vec3 F    = fresnelSchlick(max(dot(H, V), 0.0), F0);
           
        vec3 numerator    = NDF * G * F; 
        float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001; // + 0.0001 to prevent divide by zero
        vec3 specular = numerator / denominator;
        
        // kS is equal to Fresnel
        vec3 kS = F;
        // for energy conservation, the diffuse and specular light can't
        // be above 1.0 (unless the surface emits light); to preserve this
        // relationship the diffuse component (kD) should equal 1.0 - kS.
        vec3 kD = vec3(1.0) - kS;
        // multiply kD by the inverse metalness such that only non-metals 
        // have diffuse lighting, or a linear blend if partly metal (pure metals
        // have no diffuse light).
        kD *= 1.0 - metallic;

        // scale light by NdotL
        float NdotL = max(dot(N, L), 0.0);

        // add to outgoing radiance Lo
        //Lo += (kD * albedo / PI + specular) * radiance * NdotL;  // note that we already multiplied the BRDF by the Fresnel (kS) so we won't multiply by kS again
        Lo += (kD * albedo + specular) * radiance * NdotL; //heuristic
    }   

    // ambient lighting (note that the next IBL tutorial will replace 
    // this ambient lighting with environment lighting).
    //vec3 ambient = vec3(0.03) * albedo * ao;
    //vec3 ambient = vec3(0.2) * albedo; //night heuristic
    vec3 ambient = vec3(0.9) * albedo;   //day heuristic

    vec3 color = ambient + emissive + Lo;

    // HDR tonemapping
    color = color / (color + vec3(1.0));
    // gamma correct
    color = pow(color, vec3(1.0/2.2)); 
    
    fragColor = vec4(color, 1.0);
}