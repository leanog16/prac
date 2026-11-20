# Generates src/db.sql: the practice database used by every SQL lesson.
import random, datetime
random.seed(2026)
out = []
w = out.append
def q(v):
    if v is None: return 'NULL'
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
def ins(table, cols, rows):
    w(f"INSERT INTO {table} ({', '.join(cols)}) VALUES")
    w(',\n'.join('  (' + ', '.join(q(x) for x in r) + ')' for r in rows) + ';')

w("""-- Company
CREATE TABLE departments (
  dept_id   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  building  TEXT,
  budget    INTEGER
);
CREATE TABLE employees (
  emp_id     INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email      TEXT UNIQUE,
  dept_id    INTEGER REFERENCES departments(dept_id),
  manager_id INTEGER REFERENCES employees(emp_id),
  title      TEXT,
  salary     INTEGER,
  hire_date  TEXT,
  city       TEXT
);
-- University
CREATE TABLE instructors (
  instructor_id INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  dept          TEXT,
  office        TEXT
);
CREATE TABLE courses (
  course_id     INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  dept          TEXT,
  credits       INTEGER,
  instructor_id INTEGER REFERENCES instructors(instructor_id)
);
CREATE TABLE students (
  student_id  INTEGER PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  major       TEXT,
  year        INTEGER,
  gpa         REAL,
  email       TEXT,
  enrolled_on TEXT
);
CREATE TABLE enrollments (
  student_id INTEGER REFERENCES students(student_id),
  course_id  INTEGER REFERENCES courses(course_id),
  term       TEXT,
  grade      TEXT,
  score      INTEGER,
  PRIMARY KEY (student_id, course_id, term)
);
-- Store
CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  city        TEXT,
  state       TEXT,
  joined      TEXT
);
CREATE TABLE products (
  product_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT,
  price      REAL,
  stock      INTEGER
);
CREATE TABLE orders (
  order_id    INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(customer_id),
  order_date  TEXT,
  status      TEXT
);
CREATE TABLE order_items (
  order_id   INTEGER REFERENCES orders(order_id),
  product_id INTEGER REFERENCES products(product_id),
  quantity   INTEGER,
  unit_price REAL,
  PRIMARY KEY (order_id, product_id)
);
""")

ins('departments', ['dept_id','name','building','budget'], [
  (1,'Engineering','Hunt',1200000),(2,'Marketing','Talley',450000),(3,'Sales','Talley',600000),
  (4,'Support','Hunt',300000),(5,'Research','Partners II',800000),(6,'Finance','Winslow',350000)])

# employees: (id, first, last, dept, manager, title, salary, hire, city)
emps = [
 (1,'Maya','Patel',None,None,'CEO',250000,'2012-03-01','Raleigh'),
 (2,'Owen','Brooks',1,1,'VP Engineering',190000,'2014-06-15','Raleigh'),
 (3,'Lena','Ortiz',3,1,'VP Sales',175000,'2015-01-12','Charlotte'),
 (4,'Sam','Nguyen',1,2,'Engineering Manager',150000,'2016-09-01','Raleigh'),
 (5,'Priya','Shah',1,4,'Senior Engineer',138000,'2017-04-10','Durham'),
 (6,'Tom','Becker',1,4,'Engineer',112000,'2019-07-22','Raleigh'),
 (7,'Jade','Kim',1,4,'Engineer',109000,'2020-02-03','Cary'),
 (8,'Luis','Romero',1,4,'Junior Engineer',86000,'2023-06-19','Raleigh'),
 (9,'Ava','Johnson',2,1,'Marketing Director',140000,'2016-11-07','Durham'),
 (10,'Noah','Williams',2,9,'Marketing Specialist',72000,'2021-03-15','Durham'),
 (11,'Emma','Davis',2,9,'Content Writer',64000,'2022-08-01',None),
 (12,'Raj','Mehta',3,3,'Account Executive',88000,'2018-05-14','Charlotte'),
 (13,'Chloe','Martin',3,3,'Account Executive',91000,'2017-10-02','Raleigh'),
 (14,'Ben','Clark',3,3,'Sales Associate',61000,'2023-01-09','Charlotte'),
 (15,'Zoe','Lewis',3,3,'Sales Associate',59000,'2024-04-22','Charlotte'),
 (16,'Ethan','Walker',4,2,'Support Lead',82000,'2018-08-20','Raleigh'),
 (17,'Grace','Hall',4,16,'Support Engineer',63000,'2021-11-01','Raleigh'),
 (18,'Leo','Young',4,16,'Support Engineer',61000,'2022-02-14','Durham'),
 (19,'Mia','King',4,16,'Support Engineer',58000,'2024-09-03','Raleigh'),
 (20,'Ivan','Petrov',6,1,'Controller',132000,'2015-05-05','Raleigh'),
 (21,'Sofia','Rossi',6,20,'Accountant',76000,'2019-12-02','Cary'),
 (22,'Hiro','Tanaka',1,4,'Engineer',115000,'2018-03-26','Durham'),
 (23,'Nora','Scott',None,1,'Executive Assistant',68000,'2020-06-01','Raleigh'),
 (24,'Kai','Turner',2,9,'Designer',79000,'2019-09-16','Durham'),
]
rows=[]
for e in emps:
    eid,f,l,d,m,t,s,h,c = e
    email = f"{f.lower()}.{l.lower()}@acme.example" if eid not in (11,19) else None
    rows.append((eid,f,l,email,d,m,t,s,h,c))
ins('employees',['emp_id','first_name','last_name','email','dept_id','manager_id','title','salary','hire_date','city'],rows)

ins('instructors',['instructor_id','name','dept','office'],[
 (1,'Dr. Alan Turing','CSC','EB2 3201'),(2,'Dr. Grace Hopper','CSC','EB2 3202'),(3,'Dr. Ada Lovelace','MA','SAS 4110'),
 (4,'Dr. Carl Sagan','PY','Riddick 210'),(5,'Dr. Toni Morrison','ENG','Tompkins 120'),(6,'Dr. Rachel Carson','BIO','Gardner 301')])
courses=[
 (1,'CSC 116','Intro to Programming - Java','CSC',3,1),(2,'CSC 216','Software Development Fundamentals','CSC',3,2),
 (3,'CSC 316','Data Structures and Algorithms','CSC',3,1),(4,'CSC 440','Database Management Systems','CSC',3,2),
 (5,'CSC 230','C and Software Tools','CSC',3,2),(6,'MA 141','Calculus I','MA',4,3),(7,'MA 241','Calculus II','MA',4,3),
 (8,'MA 305','Linear Algebra','MA',3,3),(9,'PY 205','Physics for Engineers I','PY',4,4),(10,'ENG 101','Academic Writing','ENG',4,5),
 (11,'BIO 181','Introductory Biology','BIO',4,6),(12,'CSC 492','Senior Design Project','CSC',3,None)]
ins('courses',['course_id','code','title','dept','credits','instructor_id'],courses)
firsts=['Liam','Olivia','Noah','Emma','Ava','Elijah','Sophia','Lucas','Mia','Mason','Amelia','Ethan','Harper','Logan','Evelyn','James','Abigail','Aiden','Ella','Jackson','Aria','Sebastian','Chloe','Mateo','Layla','Henry','Nora','Wyatt','Zoe','Owen']
lasts=['Smith','Garcia','Brown','Jones','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen']
majors=['Computer Science']*9+['Mathematics']*5+['Physics']*3+['Biology']*4+['English']*3+[None]*2+['Computer Engineering']*4
studs=[]
for i in range(30):
    sid=1001+i
    maj=majors[i % len(majors)]
    random.shuffle([])
    year=random.choice([1,1,2,2,3,3,4,4])
    gpa=round(random.uniform(2.1,4.0),2) if i not in (4,17) else None
    email=f"{firsts[i].lower()}{lasts[i][0].lower()}@ncsu.example" if i not in (9,) else None
    enrolled=f"{2026-year}-08-{random.choice([14,15,16,18,20])}"
    studs.append((sid,firsts[i],lasts[i],maj,year,gpa,email,enrolled))
ins('students',['student_id','first_name','last_name','major','year','gpa','email','enrolled_on'],studs)
grades=[('A',95),('A',91),('A-',90),('B+',88),('B',84),('B',82),('B-',80),('C+',78),('C',74),('C-',70),('D',65),('F',52)]
enr=set(); rows=[]
for s in studs:
    sid=s[0]
    n = 0 if sid in (1025,1030) else random.randint(2,6)
    cs = random.sample(range(1,13), n)
    for c in cs:
        term=random.choice(['Fall 2025','Spring 2026','Spring 2026','Fall 2026'])
        if c==12: continue
        if term=='Fall 2026': g,sc=None,None
        else:
            g,sc=random.choice(grades); sc=sc+random.randint(-1,2)
        rows.append((sid,c,term,g,sc))
rows.sort()
ins('enrollments',['student_id','course_id','term','grade','score'],rows)

custs=[(1,'Ana Silva','ana@silva.example','Raleigh','NC','2023-02-11'),(2,'Ben Ford','ben.ford@example.com','Durham','NC','2023-05-30'),
 (3,'Cara Webb','cara@webb.example','Austin','TX','2023-07-04'),(4,'Dev Rao','dev.rao@example.com','Raleigh','NC','2023-09-19'),
 (5,'Eli Stone',None,'Seattle','WA','2024-01-08'),(6,'Fay Wu','fay.wu@example.com','Austin','TX','2024-02-22'),
 (7,'Gus Hale','gus@hale.example','Charlotte','NC','2024-04-03'),(8,'Hana Ito','hana.ito@example.com','Seattle','WA','2024-06-17'),
 (9,'Ike Moss','ike@moss.example','Boston','MA','2024-08-25'),(10,'Jo Park','jo.park@example.com','Raleigh','NC','2024-11-30'),
 (11,'Kim Lund',None,'Boston','MA','2025-01-14'),(12,'Lou Vega','lou@vega.example','Denver','CO','2025-03-09'),
 (13,'Max Bell','max.bell@example.com','Durham','NC','2025-05-21'),(14,'Nia Cole','nia@cole.example','Denver','CO','2025-08-02'),
 (15,'Oz Reed','oz.reed@example.com','Austin','TX','2025-10-10')]
ins('customers',['customer_id','name','email','city','state','joined'],custs)
prods=[(1,'Mechanical Keyboard','Electronics',89.99,40),(2,'Wireless Mouse','Electronics',24.99,120),(3,'27in Monitor','Electronics',279.00,15),
 (4,'USB-C Hub','Electronics',39.50,0),(5,'Desk Lamp','Home',32.00,60),(6,'Standing Desk','Furniture',449.00,8),
 (7,'Office Chair','Furniture',219.99,12),(8,'Notebook 3-Pack','Stationery',8.99,300),(9,'Gel Pens (12)','Stationery',11.49,250),
 (10,'Laptop Sleeve','Accessories',19.99,75),(11,'Webcam HD','Electronics',59.00,30),(12,'Noise-Cancelling Headphones','Electronics',199.00,22),
 (13,'Whiteboard','Home',45.00,0),(14,'Coffee Mug','Home',12.00,90),(15,'Cable Organizer','Accessories',9.99,140)]
ins('products',['product_id','name','category','price','stock'],prods)
orders=[]; items=[]
d0=datetime.date(2025,1,3)
oid=1
statuses=['delivered']*6+['shipped']*2+['pending','cancelled']
for k in range(40):
    cid=random.choice([1,1,2,3,3,4,6,6,7,8,9,10,10,12,13,14,15,2,4,8])
    d=d0+datetime.timedelta(days=k*8+random.randint(0,6))
    st=random.choice(statuses)
    if d > datetime.date(2025,12,1): st=random.choice(['pending','shipped','delivered'])
    orders.append((oid,cid,d.isoformat(),st))
    n=random.choice([1,1,2,2,3,4])
    ps=random.sample([1,2,3,5,6,7,8,9,10,11,12,14,15,2,8,9],n)
    seen=set()
    for p in ps:
        if p in seen: continue
        seen.add(p)
        price=prods[p-1][3]
        if random.random()<0.15: price=round(price*0.9,2)
        items.append((oid,p,random.choice([1,1,1,2,2,3,5]) if prods[p-1][2] in ('Stationery','Home','Accessories') else random.choice([1,1,2]),price))
    oid+=1
ins('orders',['order_id','customer_id','order_date','status'],orders)
ins('order_items',['order_id','product_id','quantity','unit_price'],items)

# ---------------------------------------------------------------- Taskboard
# The project that runs through every track. Its own random generator keeps the
# tables above byte-for-byte stable. "Today" in this data is 2026-11-20.
tr = random.Random(7)
w("""-- Taskboard
CREATE TABLE members (
  member_id  INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL,
  team       TEXT,
  joined_on  TEXT NOT NULL
);
CREATE TABLE boards (
  board_id   INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  owner_id   INTEGER NOT NULL REFERENCES members(member_id),
  created_on TEXT NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tasks (
  task_id        INTEGER PRIMARY KEY,
  board_id       INTEGER NOT NULL REFERENCES boards(board_id),
  title          TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
  priority       INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 3),
  assignee_id    INTEGER REFERENCES members(member_id),
  created_by     INTEGER NOT NULL REFERENCES members(member_id),
  created_on     TEXT NOT NULL,
  due_on         TEXT,
  done_on        TEXT,
  estimate_hours REAL,
  blocked_by     INTEGER REFERENCES tasks(task_id)
);
CREATE TABLE comments (
  comment_id INTEGER PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(task_id),
  author_id  INTEGER NOT NULL REFERENCES members(member_id),
  body       TEXT NOT NULL,
  posted_at  TEXT NOT NULL
);
CREATE TABLE labels (
  label_id INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE
);
CREATE TABLE task_labels (
  task_id  INTEGER NOT NULL REFERENCES tasks(task_id),
  label_id INTEGER NOT NULL REFERENCES labels(label_id),
  PRIMARY KEY (task_id, label_id)
);""")
members=[(1,'Ana Lima','ana@taskboard.dev','admin','Platform','2025-01-06'),(2,'Ben Okafor','ben@taskboard.dev','member','Platform','2025-02-10'),
 (3,'Chloe Martin','chloe@taskboard.dev','member','Mobile','2025-03-03'),(4,'Dev Patel','dev@taskboard.dev','member','Platform','2025-04-14'),
 (5,'Elena Rossi','elena@taskboard.dev','member','Design','2025-05-19'),(6,'Farid Haddad','farid@taskboard.dev','member','Mobile','2025-07-07'),
 (7,'Grace Kim','grace@taskboard.dev','admin','Design','2025-08-25'),(8,'Hugo Silva','hugo@taskboard.dev','member','Platform','2025-11-03'),
 (9,'Iris Novak','iris@agency.example','guest',None,'2026-02-16'),(10,'Jonas Weber','jonas@agency.example','guest',None,'2026-06-01'),
 (11,'Kenji Sato','kenji@taskboard.dev','member','Mobile','2026-10-26'),(12,'Lena Fischer','lena@taskboard.dev','member','Design','2026-09-08')]
ins('members',['member_id','name','email','role','team','joined_on'],members)
boards=[(1,'Website relaunch',7,'2026-08-03',0),(2,'Mobile app 2.0',3,'2026-08-17',0),(3,'API platform',1,'2026-07-27',0),
 (4,'Onboarding docs',5,'2026-09-14',0),(5,'Office move',2,'2026-05-04',1),(6,'Q1 planning',1,'2026-11-16',0)]
ins('boards',['board_id','name','owner_id','created_on','archived'],boards)
titles={
 1:['Draft the new homepage copy','Pick a font pairing','Design the pricing page','Build the hero section','Set up redirects from old URLs','Fix broken links in the footer','Add the cookie banner','Optimize hero images','Write the launch blog post','Test the contact form','Translate the homepage','Run an accessibility audit'],
 2:['Sign-in with passkeys','Offline mode for boards','Push notifications for assignments','Fix crash on Android 12','Dark mode','Swipe to move a task','Reduce app start time','Update the App Store screenshots','Beta test with 50 users','Fix sync conflict on reconnect','Haptic feedback on drag'],
 3:['Add cursor pagination to /tasks','Rate limit API tokens','Write the OpenAPI descriptions','Add the If-Match version check','Move sessions to Redis','Fix N+1 query on board load','Add a /health endpoint','Rotate the signing keys','Index tasks by assignee','Publish task events to the outbox','Upgrade the database driver','Write load tests','Fix timezone bug in due dates','Add webhook retries'],
 4:['Write the getting-started guide','Record a 2-minute product tour','Explain boards and columns','Document keyboard shortcuts','Add screenshots to the FAQ','Review the guide with support','Write the admin handbook'],
 5:['Book the movers','Order new desks','Set up the network','Label the cables','Farewell lunch at the old office'],
}
labels=[(1,'bug'),(2,'feature'),(3,'docs'),(4,'urgent'),(5,'design'),(6,'chore')]
tasks=[]; tl=[]
d = datetime.date
today = d(2026,11,20)
tid = 1
members_by_team = {1:[7,5,12,9,10,1], 2:[3,6,11,9], 3:[1,2,4,8], 4:[5,7,12,10], 5:[2,1,4]}
for bid in (3,1,2,4,5):
    created0 = d.fromisoformat(boards[bid-1][3])
    for i,title in enumerate(titles[bid]):
        created = created0 + datetime.timedelta(days=i*4 + tr.randint(0,3))
        if bid == 5:
            status = 'done'
        else:
            status = tr.choice(['done']*5 + ['doing']*2 + ['todo']*4)
            if created > d(2026,11,1): status = tr.choice(['todo','todo','doing'])
        prio = tr.choice([1,2,2,2,3])
        assignee = None if (status == 'todo' and tr.random() < 0.3) else tr.choice(members_by_team[bid])
        creator = tr.choice([m for m in members_by_team[bid] if m not in (9,10)])
        due = None if tr.random() < 0.25 else (created + datetime.timedelta(days=tr.choice([14,30,45,60,90,120]))).isoformat()
        done = None
        if status == 'done':
            done_d = created + datetime.timedelta(days=tr.randint(1,20))
            if done_d > today: done_d = today - datetime.timedelta(days=1)
            done = done_d.isoformat()
        est = None if tr.random() < 0.2 else tr.choice([1,2,2,3,4,4,6,8,12,16])
        tasks.append([tid,bid,title,status,prio,assignee,creator,created.isoformat(),due,done,est,None])
        for lab in tr.sample([1,2,3,4,5,6], tr.choice([0,1,1,2,2,3])):
            tl.append((tid,lab))
        tid += 1
# A dependency chain on the API board, for self-joins and recursive queries:
# "Write load tests" waits on "Fix N+1 query", which waits on "Index tasks by assignee",
# which waits on "Upgrade the database driver".
byt = {t[2]: t for t in tasks}
byt['Write load tests'][11] = byt['Fix N+1 query on board load'][0]
byt['Fix N+1 query on board load'][11] = byt['Index tasks by assignee'][0]
byt['Index tasks by assignee'][11] = byt['Upgrade the database driver'][0]
byt['Beta test with 50 users'][11] = byt['Fix sync conflict on reconnect'][0]
byt['Write the launch blog post'][11] = byt['Draft the new homepage copy'][0]
ins('tasks',['task_id','board_id','title','status','priority','assignee_id','created_by','created_on','due_on','done_on','estimate_hours','blocked_by'],[tuple(t) for t in tasks])
bodies=['Looks good to me.','Can we split this into two tasks?','Blocked until the design is final.','I can pick this up tomorrow.','Moved the deadline, see the thread.','Shipped to staging.','Needs a second review.','Found another edge case.','Done, closing.','Who owns this now?','Added screenshots.','This is more work than estimated.']
comments=[]; cid=1
for t in tasks:
    if t[1] == 5: continue
    for _ in range(tr.choice([0,0,1,1,2,3])):
        when = d.fromisoformat(t[7]) + datetime.timedelta(days=tr.randint(0,12))
        if when > today: when = today
        author = tr.choice(members_by_team[t[1]])
        comments.append((cid,t[0],author,tr.choice(bodies),f"{when.isoformat()} {tr.randint(8,18):02d}:{tr.choice(['05','15','30','45','50'])}"))
        cid += 1
comments.sort(key=lambda c: c[4])
comments=[(i+1,)+c[1:] for i,c in enumerate(comments)]
ins('comments',['comment_id','task_id','author_id','body','posted_at'],comments)
ins('labels',['label_id','name'],labels)
ins('task_labels',['task_id','label_id'],sorted(tl))
print(len(tasks),'tasks',len(comments),'comments',len(tl),'task labels')
open('src/db.sql','w').write('\n'.join(out)+'\n')
print(len(rows),'enrollments',len(orders),'orders',len(items),'items')
