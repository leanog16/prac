---
id: spring-security
title: Spring Security
summary: The filter chain and what the starter does by default, a SecurityFilterChain bean with authorizeHttpRequests, stateless APIs and CSRF, PasswordEncoder and UserDetailsService, JWT resource servers, method security with @PreAuthorize, CORS, and reading the current user.
minutes: 45
---
> [!project] Taskboard, step 8: members and team leads
> Anyone may browse the board. Members may pick up and finish tasks. Only team leads may add or remove tasks and see everyone's assignments. This step encodes those rules in the security filter chain and on the services.

## What happens when you add the starter

Add `spring-boot-starter-security` and, with no other code, **every** endpoint requires authentication. Boot generates a user named `user` with a random password printed in the log, and enables HTTP Basic, a login form, CSRF protection and security headers. Secure by default; now you configure it.

## The filter chain

Spring Security is a chain of **servlet filters** that runs **before** your controllers. Each filter has one job: read a session, parse a Bearer token, check CSRF, decide authorization, translate security exceptions into 401/403. You configure the chain with a `SecurityFilterChain` bean:

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())                                  // stateless API, no cookies
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**", "/api/auth/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/products/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()));  // Bearer JWTs
        return http.build();
    }
}
```

Rules are checked **top to bottom, first match wins**, so put specific matchers before general ones and end with `anyRequest()`.

| Method | Allows |
|---|---|
| `permitAll()` | everyone, even anonymous |
| `authenticated()` | any logged-in user |
| `hasRole("ADMIN")` | users with authority `ROLE_ADMIN` (the prefix is added for you) |
| `hasAuthority("SCOPE_orders:write")` | an exact authority string |
| `denyAll()` | nobody |

## Passwords

Never store plain passwords. Use a `PasswordEncoder`:

```java
@Bean
PasswordEncoder passwordEncoder() {
    return PasswordEncoderFactories.createDelegatingPasswordEncoder();   // bcrypt by default, upgradeable
}
```

Hashes look like `{bcrypt}$2a$10$…`; the `{id}` prefix lets you migrate algorithms later. Encode at registration with `encoder.encode(raw)` and let Spring call `encoder.matches(raw, hash)` at login.

## Where users come from: UserDetailsService

For username/password login, Spring asks a `UserDetailsService` to load the user:

```java
@Service
public class DbUserDetailsService implements UserDetailsService {
    private final UserRepository users;

    public DbUserDetailsService(UserRepository users) { this.users = users; }

    @Override
    public UserDetails loadUserByUsername(String username) {
        AppUser u = users.findByEmail(username)
                .orElseThrow(() -> new UsernameNotFoundException(username));
        return User.withUsername(u.getEmail())
                .password(u.getPasswordHash())
                .roles(u.getRole().name())
                .build();
    }
}
```

## Sessions vs tokens, and CSRF

| | Session cookie (server-rendered apps, BFFs) | Bearer token (APIs, SPAs, mobile) |
|---|---|---|
| State | server keeps a session | stateless; every request carries a token |
| Sent by | the browser automatically (cookie) | the client explicitly (`Authorization` header) |
| CSRF protection | **needed**: keep it enabled | not needed: browsers don't attach tokens automatically |

**CSRF** (cross-site request forgery) tricks a logged-in browser into sending a request with its cookies. Disable CSRF **only** for stateless APIs that don't authenticate with cookies.

## JWT resource servers

In most production systems, an identity provider (Keycloak, Auth0, Okta, AWS Cognito, Entra ID) issues tokens and your API only **validates** them. Boot does it with one property:

```properties
spring.security.oauth2.resourceserver.jwt.issuer-uri=https://auth.example.com/realms/shop
```

Spring downloads the issuer's public keys, checks the signature, expiry and issuer of every token, and turns the token's `scope` claim into `SCOPE_…` authorities. Then `hasAuthority("SCOPE_orders:write")` works in your rules.

## Method security

`@EnableMethodSecurity` lets you guard individual service or controller methods:

```java
@PreAuthorize("hasRole('ADMIN')")
public void deleteUser(long id) { ... }

@PreAuthorize("#customerId == authentication.name or hasRole('SUPPORT')")
public List<Order> ordersFor(String customerId) { ... }
```

Method security is defense in depth: URL rules can be bypassed by a new endpoint someone forgets to match; a rule on the service method can't. It's proxy-based, so the self-invocation caveat applies here too.

## The current user

```java
@GetMapping("/api/me")
public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
    return Map.of("subject", jwt.getSubject(), "scopes", jwt.getClaimAsString("scope"));
}

@GetMapping("/api/profile")
public Profile profile(Authentication auth) {
    return profiles.forUser(auth.getName());
}
```

Never take the user's identity from a request parameter or body (`?userId=42`). Always derive it from the authenticated principal.

## CORS

A browser app on `https://app.example.com` calling an API on `https://api.example.com` needs CORS. With Spring Security, configure it in the chain so preflight `OPTIONS` requests aren't rejected as unauthenticated:

```java
http.cors(Customizer.withDefaults());

@Bean
CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration cfg = new CorsConfiguration();
    cfg.setAllowedOrigins(List.of("https://app.example.com"));
    cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
    cfg.setAllowedHeaders(List.of("Authorization", "Content-Type"));
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", cfg);
    return source;
}
```

## Worked example: writing rules from an access matrix

Start with a table, not with code:

| Endpoint | Anonymous | MEMBER | LEAD |
|---|---|---|---|
| `GET /api/tasks/**` | ✓ | ✓ | ✓ |
| `POST /api/assignments`, `POST /api/assignments/{id}/return` | | ✓ | ✓ |
| `GET /api/assignments/me` | | ✓ | ✓ |
| `POST/PUT/DELETE /api/tasks/**` | | | ✓ |
| `GET /api/assignments` (everyone's) | | | ✓ |
| `/actuator/health` | ✓ | ✓ | ✓ |

Then translate row by row, **most specific first**:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/actuator/health").permitAll()
    .requestMatchers(HttpMethod.GET, "/api/tasks/**").permitAll()
    .requestMatchers("/api/tasks/**").hasRole("LEAD")              // every other method on tasks
    .requestMatchers(HttpMethod.GET, "/api/assignments").hasRole("LEAD")
    .requestMatchers("/api/assignments/**").hasAnyRole("MEMBER", "LEAD")
    .anyRequest().denyAll())                                           // nothing unlisted is reachable
```

Ending with `denyAll()` instead of `authenticated()` means a new endpoint is **closed** until someone adds a rule for it. That's a safer default for an app with clear roles.

Then add method security as a second line of defense in the service:

```java
@PreAuthorize("hasRole('LEAD')")
public void remove(long id) { ... }
```

## Who is picking up?

The member id must come from the **token**, never from the request body. Otherwise any member could pick up tasks on someone else's card:

```java
@PostMapping("/api/assignments")
public AssignmentResponse pickUp(@RequestBody PickUpRequest req, @AuthenticationPrincipal Jwt jwt) {
    long memberId = Long.parseLong(jwt.getSubject());
    return assignments.pickUp(memberId, req.taskId());
}
```

> [!plain] In plain English
> Authentication answers "who are you?"; authorization answers "what may you do?". The filter chain handles both before your controller runs.

:::quiz
q: You add spring-boot-starter-security and nothing else. What happens to your endpoints?
- nothing changes
+ every endpoint requires authentication (a generated user and password are logged)
- only POST endpoints are protected
- the app fails to start
why: Security is on by default; you open things up explicitly.
:::

:::quiz
q: Rules: `.requestMatchers("/api/**").authenticated()` then `.requestMatchers("/api/public/**").permitAll()`. Can anonymous users reach `/api/public/info`?
- yes
+ no: the first matching rule (/api/**) wins
- only with GET
- only if CSRF is disabled
why: Order specific matchers before general ones.
:::

:::quiz
q: When is it safe to disable CSRF protection?
- always, it's legacy
+ for stateless APIs that authenticate with bearer tokens, not cookies
- whenever you use HTTPS
- for GET endpoints only
why: CSRF exploits automatically-sent cookies. Token-in-header APIs aren't exposed to it.
:::

:::quiz
q: `hasRole("ADMIN")` checks for which authority string?
- ADMIN
+ ROLE_ADMIN
- SCOPE_ADMIN
- admin
why: hasRole adds the ROLE_ prefix; hasAuthority checks the exact string.
:::

:::exercise
id: ss-chain
level: 3
title: A stateless API chain
mode: code
lang: java
file: SecurityConfig.java
---
Complete the `SecurityFilterChain` bean: disable CSRF, make sessions **STATELESS**, permit everyone on `/api/auth/**`, require role `ADMIN` on `/api/admin/**`, require authentication for **any other request**, and enable the JWT resource server with defaults.
---starter
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        return http.build();
    }
}
---rule
\.csrf\(\s*(\w+)\s*->\s*\1\.disable\(\s*\)\s*\)|\.csrf\(\s*AbstractHttpConfigurer::disable\s*\)
Disable CSRF
---rule
sessionCreationPolicy\(\s*SessionCreationPolicy\.STATELESS\s*\)
Stateless sessions
---rule
requestMatchers\(\s*"/api/auth/\*\*"\s*\)\.permitAll\(\s*\)
`/api/auth/**` → `permitAll()`
---rule
requestMatchers\(\s*"/api/admin/\*\*"\s*\)\.hasRole\(\s*"ADMIN"\s*\)
`/api/admin/**` → `hasRole("ADMIN")`
---rule
anyRequest\(\s*\)\.authenticated\(\s*\)
`anyRequest().authenticated()`
---rule
oauth2ResourceServer\(\s*(\w+)\s*->\s*\1\.jwt\(\s*Customizer\.withDefaults\(\s*\)\s*\)\s*\)
`oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()))`
---rule
permitAll[\s\S]*hasRole[\s\S]*anyRequest
Specific rules before `anyRequest()`
---solution
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()));
        return http.build();
    }
}
:::

:::exercise
id: ss-encoder
level: 2
title: A password encoder bean
mode: code
lang: java
file: PasswordConfig.java
---
Define a `@Bean` `PasswordEncoder passwordEncoder()` returning `PasswordEncoderFactories.createDelegatingPasswordEncoder()`.
---starter
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class PasswordConfig {
}
---rule
@Bean\s*\n\s*(public\s+)?PasswordEncoder\s+passwordEncoder\(\s*\)
`@Bean PasswordEncoder passwordEncoder()`
---rule
return\s+PasswordEncoderFactories\.createDelegatingPasswordEncoder\(\s*\)\s*;
Return the delegating encoder
---solution
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class PasswordConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }
}
:::

:::exercise
id: ss-register
level: 2
title: Hash on registration
mode: code
lang: java
file: RegistrationService.java
---
In `register`, store the **encoded** password: replace the plain `cmd.password()` with `encoder.encode(cmd.password())`.
---starter
package com.example.demo;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class RegistrationService {

    private final UserRepository users;
    private final PasswordEncoder encoder;

    public RegistrationService(UserRepository users, PasswordEncoder encoder) {
        this.users = users;
        this.encoder = encoder;
    }

    public AppUser register(RegisterCommand cmd) {
        return users.save(new AppUser(cmd.email(), cmd.password()));
    }
}
---rule
new\s+AppUser\(\s*cmd\.email\(\s*\)\s*,\s*encoder\.encode\(\s*cmd\.password\(\s*\)\s*\)\s*\)|encoder\.encode\(\s*cmd\.password\(\s*\)\s*\)
Encode the password
---rule
!new\s+AppUser\(\s*cmd\.email\(\s*\)\s*,\s*cmd\.password\(\s*\)\s*\)
Don't store the raw password
---solution
package com.example.demo;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class RegistrationService {

    private final UserRepository users;
    private final PasswordEncoder encoder;

    public RegistrationService(UserRepository users, PasswordEncoder encoder) {
        this.users = users;
        this.encoder = encoder;
    }

    public AppUser register(RegisterCommand cmd) {
        return users.save(new AppUser(cmd.email(), encoder.encode(cmd.password())));
    }
}
:::

:::exercise
id: ss-preauthorize
level: 2
title: Admin-only method
mode: code
lang: java
file: UserAdminService.java
---
Allow only users with role `ADMIN` to call `deleteUser`, using method security.
---starter
package com.example.demo;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

@Service
public class UserAdminService {

    public void deleteUser(long id) {
        users.deleteById(id);
    }
}
---rule
@PreAuthorize\(\s*"hasRole\('ADMIN'\)"\s*\)\s*\n\s*public\s+void\s+deleteUser
`@PreAuthorize("hasRole('ADMIN')")` on `deleteUser`
---solution
package com.example.demo;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

@Service
public class UserAdminService {

    @PreAuthorize("hasRole('ADMIN')")
    public void deleteUser(long id) {
        users.deleteById(id);
    }
}
:::

:::exercise
id: ss-me
level: 2
title: Who am I?
mode: code
lang: java
file: MeController.java
---
Write `GET /api/me` that takes the token as `@AuthenticationPrincipal Jwt jwt` and returns `Map.of("subject", jwt.getSubject())`.
---starter
package com.example.demo;

import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
public class MeController {
}
---rule
@GetMapping\(\s*"/api/me"\s*\)
`@GetMapping("/api/me")`
---rule
@AuthenticationPrincipal\s+Jwt\s+jwt
`@AuthenticationPrincipal Jwt jwt`
---rule
return\s+Map\.of\(\s*"subject"\s*,\s*jwt\.getSubject\(\s*\)\s*\)\s*;
Return the subject
---solution
package com.example.demo;

import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
public class MeController {

    @GetMapping("/api/me")
    public Map<String, String> me(@AuthenticationPrincipal Jwt jwt) {
        return Map.of("subject", jwt.getSubject());
    }
}
:::

:::exercise
id: ss-issuer
level: 1
title: Trust an issuer
mode: code
lang: properties
file: application.properties
---
Configure the JWT resource server to trust tokens issued by `https://auth.example.com/realms/shop`.
---starter
spring.application.name=shop
---rule
^spring\.security\.oauth2\.resourceserver\.jwt\.issuer-uri\s*=\s*https://auth\.example\.com/realms/shop\s*$
`spring.security.oauth2.resourceserver.jwt.issuer-uri=https://auth.example.com/realms/shop`
---solution
spring.application.name=shop
spring.security.oauth2.resourceserver.jwt.issuer-uri=https://auth.example.com/realms/shop
:::

:::exercise
id: ss-predict
level: 3
title: Predict: 401 or 403?
mode: answer
---
A request to `/api/admin/users` carries a valid JWT for a user whose only authority is `ROLE_USER`. The chain has `.requestMatchers("/api/admin/**").hasRole("ADMIN")`. Which status code comes back?
---answer
403
---solution
403
---explain
The user is authenticated (so not 401) but lacks the required role.
:::

:::exercise
id: proj-sp-08-chain
level: 4
title: "Project 8: Taskboard's access rules"
mode: code
lang: java
file: SecurityConfig.java
path: spring/src/main/java/dev/taskboard/SecurityConfig.java
---
Fill in `authorizeHttpRequests` following the access matrix: `/actuator/health` → `permitAll()`; `GET /api/tasks/**` → `permitAll()`; any other `/api/tasks/**` → `hasRole("LEAD")`; `GET /api/assignments` → `hasRole("LEAD")`; `/api/assignments/**` → `hasAnyRole("MEMBER", "LEAD")`; everything else → `denyAll()`.
---starter
package dev.taskboard;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()));
        return http.build();
    }
}
---rule
requestMatchers\(\s*"/actuator/health"\s*\)\.permitAll\(\s*\)
Health is public
---rule
requestMatchers\(\s*HttpMethod\.GET\s*,\s*"/api/tasks/\*\*"\s*\)\.permitAll\(\s*\)
Browsing tasks is public
---rule
requestMatchers\(\s*"/api/tasks/\*\*"\s*\)\.hasRole\(\s*"LEAD"\s*\)
Changing tasks needs LEAD
---rule
HttpMethod\.GET\s*,\s*"/api/tasks/\*\*"\s*\)\.permitAll\(\s*\)[\s\S]*requestMatchers\(\s*"/api/tasks/\*\*"\s*\)\.hasRole
The GET rule comes first
---rule
requestMatchers\(\s*HttpMethod\.GET\s*,\s*"/api/assignments"\s*\)\.hasRole\(\s*"LEAD"\s*\)
All assignments: LEAD
---rule
requestMatchers\(\s*"/api/assignments/\*\*"\s*\)\.hasAnyRole\(\s*"MEMBER"\s*,\s*"LEAD"\s*\)
Assignments: MEMBER or LEAD
---rule
anyRequest\(\s*\)\.denyAll\(\s*\)
Deny everything else
---rule
!anyRequest\(\s*\)\.authenticated
No `anyRequest().authenticated()`
---solution
package dev.taskboard;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/tasks/**").permitAll()
                .requestMatchers("/api/tasks/**").hasRole("LEAD")
                .requestMatchers(HttpMethod.GET, "/api/assignments").hasRole("LEAD")
                .requestMatchers("/api/assignments/**").hasAnyRole("MEMBER", "LEAD")
                .anyRequest().denyAll())
            .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()));
        return http.build();
    }
}
:::

:::exercise
id: proj-sp-08-borrow-endpoint
level: 3
title: "Project 8b: pick up as yourself"
mode: code
lang: java
file: AssignmentController.java
path: spring/src/main/java/dev/taskboard/AssignmentController.java
---
Write `@PostMapping("/api/assignments")` `AssignmentResponse pickUp(@RequestBody PickUpRequest req, @AuthenticationPrincipal Jwt jwt)` that takes the member id from `Long.parseLong(jwt.getSubject())` (not from the request) and returns `assignments.pickUp(memberId, req.taskId())`.
---starter
package dev.taskboard;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
public class AssignmentController {

    private final AssignmentService assignments;

    public AssignmentController(AssignmentService assignments) {
        this.assignments = assignments;
    }
}
---rule
@PostMapping\(\s*"/api/assignments"\s*\)
`@PostMapping("/api/assignments")`
---rule
AssignmentResponse\s+pickUp\(\s*@RequestBody\s+PickUpRequest\s+req\s*,\s*@AuthenticationPrincipal\s+Jwt\s+jwt\s*\)
The signature
---rule
long\s+memberId\s*=\s*Long\.parseLong\(\s*jwt\.getSubject\(\s*\)\s*\)
Member id from the token
---rule
return\s+assignments\.pickUp\(\s*memberId\s*,\s*req\.taskId\(\s*\)\s*\)\s*;
Delegate to the service
---rule
!req\.memberId\(
Never trust a member id from the body
---solution
package dev.taskboard;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
public class AssignmentController {

    private final AssignmentService assignments;

    public AssignmentController(AssignmentService assignments) {
        this.assignments = assignments;
    }

    @PostMapping("/api/assignments")
    public AssignmentResponse pickUp(@RequestBody PickUpRequest req, @AuthenticationPrincipal Jwt jwt) {
        long memberId = Long.parseLong(jwt.getSubject());
        return assignments.pickUp(memberId, req.taskId());
    }
}
:::
