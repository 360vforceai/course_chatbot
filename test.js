async function test() {
  const url = 'https://classes.rutgers.edu//soc/api/courses.json?year=2026&term=1&campus=NB&subject=198';
  const res = await fetch(url);
  const courses = await res.json();
  
  const matches = courses.filter(c => c.courseNumber === '112');
  console.log(JSON.stringify(matches.map(c => ({ title: c.title, courseNumber: c.courseNumber, subject: c.subject })), null, 2));
}

test();