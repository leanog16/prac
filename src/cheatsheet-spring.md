## Build and run

| Command | Does |
|---|---|
| `./mvnw compile` / `test` / `package` / `verify` | lifecycle phases (each runs the earlier ones) |
| `./mvnw clean package -DskipTests` | rebuild the jar without tests |
| `./mvnw spring-boot:run` | run from source |
| `java -jar target/app.jar --server.port=9090` | run the fat jar with an override |
| `SPRING_PROFILES_ACTIVE=prod java -jar app.jar` | activate a profile |

Property precedence (high → low): command-line args → `-D` system properties → environment variables (`SERVER_PORT`) → `application-{profile}.properties` → `application.properties`.

## Beans

```java
@Service
public class OrderService {
    private final OrderRepository orders;            // constructor injection, final
    public OrderService(OrderRepository orders) { this.orders = orders; }
}

@Configuration
public class AppConfig {
    @Bean Clock clock() { return Clock.systemUTC(); }
}
```

`@Component` `@Service` `@Repository` `@RestController` `@Configuration` · `@Primary` / `@Qualifier("name")` for several implementations · `@Profile("dev")` · `@ConditionalOnProperty` · singletons are shared: keep them stateless.

## REST

```java
@RestController
@RequestMapping("/api/books")
public class BookController {
    @GetMapping("/{id}")
    public ResponseEntity<BookResponse> get(@PathVariable long id) {
        return books.find(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<BookResponse> create(@Valid @RequestBody CreateBook body) {
        BookResponse b = books.create(body);
        return ResponseEntity.created(URI.create("/api/books/" + b.id())).body(b);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) { books.delete(id); }
}
```

`@RequestParam(defaultValue = "20") int size` · `@RequestHeader("X-Request-ID") String rid` · records as DTOs.

## Validation and errors

`@NotBlank @Size(max=100) @Email @Min @Max @Positive @Past @Pattern` on DTO fields; `@Valid` on the body; `@Validated` on the class for parameters; `@Valid` on nested fields.

```java
@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(NotFoundException.class)
    public ProblemDetail notFound(NotFoundException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
    }
}
```

## JPA

```java
@Entity @Table(name = "products")
public class Product {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, unique = true) private String sku;
    @Enumerated(EnumType.STRING) private Status status;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "category_id") private Category category;
    @Version private long version;
    protected Product() {}
}

public interface ProductRepository extends JpaRepository<Product, Long> {
    Optional<Product> findBySku(String sku);
    Page<Product> findByStatus(Status status, Pageable pageable);
    @Query("select p from Product p join fetch p.category where p.status = :s")
    List<Product> withCategory(@Param("s") Status s);
}
```

`@Transactional` on service methods (unchecked exceptions roll back; `rollbackFor` for checked; self-invocation bypasses the proxy) · `@Transactional(readOnly = true)` for reads · N+1 → `join fetch` / `@EntityGraph` · `ddl-auto=validate` + Flyway `V1__init.sql` in production · `open-in-view=false`.

## Configuration

```java
@Validated
@ConfigurationProperties(prefix = "app.mail")
public record MailProperties(@NotBlank String host, @Min(1) int port) {}
```

`@ConfigurationPropertiesScan` on the main class · `${DB_PASSWORD}` placeholders, never real secrets · `logging.level.com.example=DEBUG` · `management.endpoints.web.exposure.include=health,info,prometheus`.

## Security

```java
@Bean
SecurityFilterChain api(HttpSecurity http) throws Exception {
    return http
        .csrf(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(a -> a
            .requestMatchers("/actuator/health", "/api/auth/**").permitAll()
            .requestMatchers("/api/admin/**").hasRole("ADMIN")
            .anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()))
        .build();
}
```

First matching rule wins · `PasswordEncoderFactories.createDelegatingPasswordEncoder()` · `@PreAuthorize("hasRole('ADMIN')")` with `@EnableMethodSecurity` · `@AuthenticationPrincipal Jwt jwt`.

## Testing

| Annotation | Loads |
|---|---|
| none (plain JUnit + Mockito) | nothing: fastest |
| `@WebMvcTest(X.class)` + `MockMvc` + `@MockitoBean` | web layer |
| `@DataJpaTest` | JPA + repositories (rolls back each test) |
| `@SpringBootTest(webEnvironment = RANDOM_PORT)` | everything |
| `@Testcontainers` + `@Container @ServiceConnection` | a real database in Docker |

```java
mvc.perform(get("/api/books/1")).andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Dune"));
```
