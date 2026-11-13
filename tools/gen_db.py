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
open('src/db.sql','w').write('\n'.join(out)+'\n')
print(len(rows),'enrollments',len(orders),'orders',len(items),'items')
