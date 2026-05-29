const SUPABASE_URL = "https://xbnurfmszprytqsdtbva.supabase.co";
const SUPABASE_KEY = "sb_publishable_d4gI2mbbmX-ihEXNMUFZuQ_It98nl3K";

let supabaseClient = null;

if (window.supabase) {
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );
} else {
  console.warn("Supabase library did not load. App will keep running without cloud sync.");
}

async function testConnection() {
  if (!supabaseClient) return;

  const { data, error } = await supabaseClient
    .from("life_entries")
    .select("*");

  if (error) {
    console.error("Supabase error:", error);
    return;
  }

  console.log("Connected to Supabase:", data);
}

testConnection();

const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn(`Could not read ${key}`, error);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`Could not save ${key}`, error);
    }
  }
};

let calendar = store.get("lifeCommand.calendar", []);
let homework = store.get("lifeCommand.homework", []);
let todos = store.get("lifeCommand.todos", []);
let shopping = store.get("lifeCommand.shopping", []);
let projects = store.get("lifeCommand.projects", []);
let rollingLog = store.get("lifeCommand.rollingLog", []);
let activeProjectId = null;

const weatherUrl = "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,wind_speed_10m,relative_humidity_2m,precipitation,cloud_cover&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation_probability,precipitation,cloud_cover,visibility&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto";

const GOOGLE_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events";
const LAUNCH_LIBRARY_URL = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5&mode=detailed";

let tokenClient = null;
let gapiInited = false;
let gisInited = false;
let googleCalendarReady = false;
let spaceLaunches = [];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function safeText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function saveAll() {
  store.set("lifeCommand.calendar", calendar);
  store.set("lifeCommand.homework", homework);
  store.set("lifeCommand.todos", todos);
  store.set("lifeCommand.shopping", shopping);
  store.set("lifeCommand.projects", projects);
  store.set("lifeCommand.rollingLog", rollingLog);
}

function updateClock() {
  const now = new Date();

  safeText("todayLabel", now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  }));

  safeText("timeLabel", now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }));
}

function render() {
  renderCommandDashboard();
  renderProjects();
  renderTimeline();
  renderCalendar();
  renderHomework();
  renderChecklist("todoList", todos, "todos");
  renderChecklist("shoppingList", shopping, "shopping");
  renderRollingLog();
  updateCounts();
  saveAll();
}

function updateCounts() {
  safeText("todoCount", todos.filter(item => !item.done).length);
  safeText("homeworkCount", homework.length);
  safeText("shoppingCount", shopping.filter(item => !item.done).length);
}

function getPriorityRank(priority) {
  if (priority === "critical") return 1;
  if (priority === "important") return 2;
  return 3;
}

function formatPriority(priority) {
  if (priority === "critical") return "Critical";
  if (priority === "important") return "Important";
  return "Low";
}

function renderCommandDashboard() {
  renderNextEventCard();
  renderTopTodoCard();
  renderNextAssignmentsCard();
}

function renderNextEventCard() {
  const titleEl = $("nextEventTitle");
  const timeEl = $("nextEventTime");
  if (!titleEl || !timeEl) return;

  const now = new Date();
  const upcoming = getExpandedCalendarEvents()
    .map(event => ({ ...event, dateObj: new Date(`${event.date}T${event.time || "00:00"}`) }))
    .filter(event => event.dateObj >= now)
    .sort((a, b) => a.dateObj - b.dateObj)[0];

  if (!upcoming) {
    titleEl.textContent = "No events scheduled";
    timeEl.textContent = "Add an event to begin timeline tracking.";
    return;
  }

  titleEl.textContent = upcoming.title;
  timeEl.textContent = upcoming.dateObj.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderTopTodoCard() {
  const list = $("topTodoList");
  if (!list) return;

  list.innerHTML = "";

  const topTodos = todos
    .filter(todo => !todo.done)
    .sort((a, b) => getPriorityRank(a.priority || "important") - getPriorityRank(b.priority || "important"))
    .slice(0, 3);

  if (topTodos.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No open todos.";
    list.appendChild(li);
    return;
  }

  topTodos.forEach(todo => {
    const li = document.createElement("li");
    li.innerHTML = `${todo.text} <small>(${formatPriority(todo.priority || "important")})</small>`;
    list.appendChild(li);
  });
}

function renderNextAssignmentsCard() {
  const list = $("nextAssignmentsList");
  if (!list) return;

  list.innerHTML = "";

  const nextAssignments = [...homework]
    .sort((a, b) => `${a.due}T${a.dueTime || "23:59"}`.localeCompare(`${b.due}T${b.dueTime || "23:59"}`))
    .slice(0, 3);

  if (nextAssignments.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No assignments added.";
    list.appendChild(li);
    return;
  }

  nextAssignments.forEach(assignment => {
    const li = document.createElement("li");
    li.innerHTML = `${assignment.task} <small>${assignment.className} · due ${assignment.due}${assignment.dueTime ? " at " + formatTimelineTime(assignment.dueTime) : ""}</small>`;
    list.appendChild(li);
  });
}

function renderCalendar() {
  const list = $("calendarList");
  if (!list) return;

  list.innerHTML = "";

  calendar
    .sort((a, b) => `${a.date}T${a.time || "00:00"}`.localeCompare(`${b.date}T${b.time || "00:00"}`))
    .forEach(event => {
      const repeatText = event.repeat && event.repeat !== "none"
        ? ` · repeats ${event.repeat}${event.repeatUntil ? " until " + event.repeatUntil : ""}`
        : "";
      const projectText = event.projectId ? " · project event" : "";
      const googleText = event.source === "google" ? " · Google" : "";

      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `
        <div class="item-main">
          <strong>${event.title}</strong>
          <small>${event.date}${event.time ? " at " + formatTimelineTime(event.time) : ""}${event.endTime ? "–" + formatTimelineTime(event.endTime) : ""}${projectText}${googleText}${repeatText}</small>
        </div>
        <div class="actions">
          <button class="delete" onclick="removeCalendar('${event.id}')">Delete</button>
        </div>
      `;
      list.appendChild(li);
    });
}

function renderHomework() {
  const list = $("homeworkList");
  if (!list) return;

  list.innerHTML = "";

  homework
    .sort((a, b) => `${a.due}T${a.dueTime || "23:59"}`.localeCompare(`${b.due}T${b.dueTime || "23:59"}`))
    .forEach(task => {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `
        <div class="item-main">
          <strong>${task.className}: ${task.task}</strong>
          <small>Due ${task.due}${task.dueTime ? " at " + formatTimelineTime(task.dueTime) : ""}</small>
        </div>
        <div class="actions">
          <button class="delete" onclick="removeHomework('${task.id}')">Done</button>
        </div>
      `;
      list.appendChild(li);
    });
}

function renderChecklist(listId, data, type) {
  const list = $(listId);
  if (!list) return;

  list.innerHTML = "";

  data.forEach(item => {
    const li = document.createElement("li");
    li.className = item.done ? "item done" : "item";
    const priority = item.priority || "important";

    li.innerHTML = `
      <div class="item-main">
        ${type === "todos" ? `<span class="priority-pill priority-${priority}">${formatPriority(priority)}</span>` : ""}
        <strong>${item.text}</strong>
      </div>
      <div class="actions">
        <button class="complete" onclick="toggleItem('${type}', '${item.id}')">${item.done ? "Undo" : "Done"}</button>
        <button class="delete" onclick="deleteItem('${type}', '${item.id}')">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function renderTimeline() {
  const list = $("timelineList");
  if (!list) return;

  list.innerHTML = "";
  const expandedEvents = getExpandedCalendarEvents();

  if (expandedEvents.length === 0) {
    const empty = document.createElement("li");
    empty.className = "timeline-empty";
    empty.textContent = "No calendar events yet. Add one in the Calendar panel.";
    list.appendChild(empty);
    return;
  }

  let currentDate = "";

  expandedEvents.forEach(event => {
    if (event.date !== currentDate) {
      currentDate = event.date;
      const groupHeader = document.createElement("li");
      groupHeader.className = "timeline-date-heading";
      groupHeader.textContent = formatTimelineDate(event.date);
      list.appendChild(groupHeader);
    }

    const repeatText = event.repeat && event.repeat !== "none"
      ? `<span class="timeline-repeat-label"> · repeats ${event.repeat}</span>`
      : "";
    const projectText = event.projectId ? ` <span class="project-source">· project event</span>` : "";
    const googleText = event.source === "google" ? ` <span class="project-source">· Google</span>` : "";

    const li = document.createElement("li");
    li.className = event.generated ? "timeline-item generated" : "timeline-item";
    li.innerHTML = `
      <div class="timeline-time">${event.time ? formatTimelineTime(event.time) : "All day"}${event.endTime ? `<small>${formatTimelineTime(event.endTime)}</small>` : ""}</div>
      <div class="timeline-content">
        <span class="timeline-category">Calendar</span>
        <strong>${event.title}</strong>
        <small>${event.date}${projectText}${googleText}${repeatText}</small>
      </div>
      <div class="actions">
        <button class="delete" onclick="removeCalendar('${event.sourceId}')">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function getExpandedCalendarEvents() {
  const expanded = [];

  calendar.forEach(event => {
    const repeat = event.repeat || "none";

    if (repeat === "none") {
      expanded.push({ ...event, sourceId: event.id, generated: false });
      return;
    }

    const startDate = new Date(event.date + "T00:00:00");
    const untilDate = event.repeatUntil
      ? new Date(event.repeatUntil + "T00:00:00")
      : addMonths(startDate, 3);

    let current = new Date(startDate);

    while (current <= untilDate) {
      expanded.push({
        ...event,
        id: `${event.id}-${formatDateInput(current)}`,
        sourceId: event.id,
        date: formatDateInput(current),
        generated: formatDateInput(current) !== event.date
      });

      current = getNextRepeatDate(current, repeat);
    }
  });

  return expanded.sort((a, b) => {
    const aValue = `${a.date}T${a.time || "00:00"}`;
    const bValue = `${b.date}T${b.time || "00:00"}`;
    return aValue.localeCompare(bValue);
  });
}

function getNextRepeatDate(date, repeat) {
  const next = new Date(date);
  if (repeat === "daily") next.setDate(next.getDate() + 1);
  if (repeat === "weekly") next.setDate(next.getDate() + 7);
  if (repeat === "monthly") next.setMonth(next.getMonth() + 1);
  if (repeat === "yearly") next.setFullYear(next.getFullYear() + 1);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function formatDateInput(date) {
  return date.toISOString().split("T")[0];
}

function formatTimelineDate(dateText) {
  const date = new Date(dateText + "T00:00:00");
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatTimelineTime(timeText) {
  const [hourText, minuteText] = timeText.split(":");
  const date = new Date();
  date.setHours(Number(hourText));
  date.setMinutes(Number(minuteText));
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

async function loadWeather() {
  const tempEl = $("weatherTemp");
  const windEl = $("weatherWind");
  const updatedEl = $("weatherUpdated");
  const hourlyEl = $("weatherHourly");
  const sunriseEl = $("weatherSunrise");
  const sunsetEl = $("weatherSunset");
  const stargazingScoreEl = $("stargazingScore");
  const stargazingDetailsEl = $("stargazingDetails");

  if (!tempEl || !windEl || !updatedEl || !hourlyEl) return;

  tempEl.textContent = "Loading...";
  windEl.textContent = "Loading...";
  updatedEl.textContent = "Fetching Open-Meteo data...";
  hourlyEl.innerHTML = "";

  try {
    const response = await fetch(weatherUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Weather request failed");

    const data = await response.json();
    const current = data.current;
    const hourly = data.hourly;
    const daily = data.daily;

    tempEl.textContent = `${Math.round(current.temperature_2m)}°F`;
    windEl.textContent = `${Math.round(current.wind_speed_10m)} mph`;
    updatedEl.textContent = `Updated ${formatWeatherDateTime(current.time)}`;

    if (sunriseEl && daily?.sunrise?.length) sunriseEl.textContent = formatWeatherTime(daily.sunrise[0]);
    if (sunsetEl && daily?.sunset?.length) sunsetEl.textContent = formatWeatherTime(daily.sunset[0]);

    const currentHourIndex = getCurrentHourIndex(hourly.time);
    const startIndex = currentHourIndex >= 0 ? currentHourIndex : 0;
    const moon = getMoonPhase(new Date());

    renderStargazing({
      cloudCover: current.cloud_cover,
      humidity: current.relative_humidity_2m,
      precipitation: current.precipitation,
      visibility: hourly.visibility[startIndex],
      precipChance: hourly.precipitation_probability[startIndex],
      moonPhase: moon.phaseName,
      moonIllumination: moon.illumination
    }, stargazingScoreEl, stargazingDetailsEl);

    hourly.time.slice(startIndex, startIndex + 24).forEach((time, index) => {
      const realIndex = startIndex + index;
      const card = document.createElement("article");
      card.className = "hourly-card";
      card.innerHTML = `
        <span>${index === 0 ? "Now" : formatWeatherTime(time)}</span>
        <strong>${Math.round(hourly.temperature_2m[realIndex])}°F</strong>
        <small>Wind ${Math.round(hourly.wind_speed_10m[realIndex])} mph</small>
        <small>Humidity ${hourly.relative_humidity_2m[realIndex]}%</small>
        <small>Clouds ${hourly.cloud_cover[realIndex]}%</small>
        <small>Rain ${hourly.precipitation_probability[realIndex]}%</small>
      `;
      hourlyEl.appendChild(card);
    });
  } catch (error) {
    tempEl.textContent = "Unavailable";
    windEl.textContent = "Unavailable";
    updatedEl.textContent = "Weather could not load. Check your internet connection.";
    if (stargazingScoreEl) stargazingScoreEl.textContent = "Unavailable";
    if (stargazingDetailsEl) stargazingDetailsEl.textContent = "Sky conditions could not be checked.";
  }
}

function getCurrentHourIndex(hourlyTimes) {
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  return hourlyTimes.findIndex(time => {
    const forecastTime = new Date(time);
    return forecastTime >= currentHour;
  });
}

function formatWeatherTime(timeText) {
  return new Date(timeText).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatWeatherDateTime(timeText) {
  return new Date(timeText).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getMoonPhase(date) {
  const knownNewMoon = new Date("2000-01-06T18:14:00Z");
  const lunarCycleDays = 29.53058867;
  const daysSinceKnownNewMoon = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
  const cyclePosition = ((daysSinceKnownNewMoon % lunarCycleDays) + lunarCycleDays) % lunarCycleDays;
  const phase = cyclePosition / lunarCycleDays;
  const illumination = Math.round((1 - Math.cos(2 * Math.PI * phase)) / 2 * 100);

  let phaseName = "New Moon";
  if (phase >= 0.03 && phase < 0.22) phaseName = "Waxing Crescent";
  if (phase >= 0.22 && phase < 0.28) phaseName = "First Quarter";
  if (phase >= 0.28 && phase < 0.47) phaseName = "Waxing Gibbous";
  if (phase >= 0.47 && phase < 0.53) phaseName = "Full Moon";
  if (phase >= 0.53 && phase < 0.72) phaseName = "Waning Gibbous";
  if (phase >= 0.72 && phase < 0.78) phaseName = "Last Quarter";
  if (phase >= 0.78 && phase < 0.97) phaseName = "Waning Crescent";

  return { phaseName, illumination };
}

function renderStargazing(sky, scoreEl, detailsEl) {
  if (!scoreEl || !detailsEl) return;

  let score = 100;
  score -= Math.min(sky.cloudCover || 0, 100) * 0.55;
  score -= Math.min(sky.humidity || 0, 100) * 0.12;
  score -= Math.min(sky.precipChance || 0, 100) * 0.22;
  score -= Math.min(sky.moonIllumination || 0, 100) * 0.28;

  if ((sky.precipitation || 0) > 0) score -= 25;
  if (sky.visibility && sky.visibility < 52800) score -= 12;

  score = Math.max(0, Math.round(score));

  let label = "Great";
  if (score < 75) label = "Decent";
  if (score < 50) label = "Poor";
  if (score < 30) label = "Bad";

  scoreEl.textContent = `${label} · ${score}/100`;
  detailsEl.textContent = `Clouds ${sky.cloudCover ?? "?"}% · Humidity ${sky.humidity ?? "?"}% · Rain chance ${sky.precipChance ?? "?"}% · Moon ${sky.moonPhase} (${sky.moonIllumination}% lit)`;
}

function getActiveProject() {
  return projects.find(project => project.id === activeProjectId);
}

function saveProjects() {
  store.set("lifeCommand.projects", projects);
}

function setDashboardVisibility(projectOpen) {
  const sections = [
    $("weatherSection"),
    $("calendarSection"),
    $("timelineSection"),
    $("homeworkSection"),
    $("todosSection"),
    $("shoppingSection"),
    $("notesSection")
  ];

  sections.forEach(section => {
    if (!section) return;
    section.classList.toggle("dashboard-hidden", projectOpen);
  });

  document.body.classList.toggle("project-focus-mode", projectOpen);
}

function renderProjects() {
  const cards = $("projectCards");
  if (!cards) return;

  cards.innerHTML = "";

  if (projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.textContent = "No projects yet. Create one to open a dedicated workspace.";
    cards.appendChild(empty);
  }

  projects.forEach(project => {
    project.todos = project.todos || [];
    project.events = project.events || [];
    project.files = project.files || [];
    project.notes = project.notes || "";

    const card = document.createElement("button");
    card.type = "button";
    card.className = "project-card";
    card.onclick = () => openProject(project.id);

    const todoCount = project.todos.filter(todo => !todo.done).length;
    const eventCount = project.events.length;
    const fileCount = project.files.length;

    card.innerHTML = `
      <strong>${project.name}</strong>
      <small>${todoCount} todos · ${eventCount} events · ${fileCount} files</small>
    `;

    cards.appendChild(card);
  });

  renderProjectWorkspace();
  saveProjects();
}

function openProject(id) {
  activeProjectId = id;
  renderProjects();

  const project = getActiveProject();
  if (project && project.githubRepo && !project.githubData) {
    loadProjectGithub(project.id);
  }
}

function closeProjectWorkspace() {
  activeProjectId = null;
  setDashboardVisibility(false);
  closeSettingsPage();
  closeSpaceDashboard();
  renderProjects();
}

function renderProjectWorkspace() {
  const workspace = $("projectWorkspace");
  const project = getActiveProject();

  if (!workspace) return;

  if (!project) {
    workspace.classList.add("hidden");
    setDashboardVisibility(false);
    return;
  }

  workspace.classList.remove("hidden");
  setDashboardVisibility(true);

  safeText("activeProjectTitle", project.name);

  renderProjectTodos(project);
  renderProjectEvents(project);
  renderProjectFiles(project);
  renderProjectGithub(project);

  const notes = $("projectNotesArea");
  if (notes) notes.value = project.notes || "";
}

function renderProjectTodos(project) {
  const list = $("projectTodoList");
  if (!list) return;

  list.innerHTML = "";

  project.todos.forEach(todo => {
    const li = document.createElement("li");
    li.className = todo.done ? "item done" : "item";
    li.innerHTML = `
      <div class="item-main">
        <strong>${todo.text}</strong>
      </div>
      <div class="actions">
        <button class="complete" onclick="toggleProjectTodo('${project.id}', '${todo.id}')">${todo.done ? "Undo" : "Done"}</button>
        <button class="delete" onclick="deleteProjectTodo('${project.id}', '${todo.id}')">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function renderProjectEvents(project) {
  const list = $("projectEventList");
  if (!list) return;

  list.innerHTML = "";

  project.events
    .sort((a, b) => `${a.date}T${a.time || "00:00"}`.localeCompare(`${b.date}T${b.time || "00:00"}`))
    .forEach(event => {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `
        <div class="item-main">
          <strong>${event.title}</strong>
          <small>${event.date}${event.time ? " at " + event.time : ""}</small>
        </div>
        <div class="actions">
          <button class="delete" onclick="deleteProjectEvent('${project.id}', '${event.id}')">Delete</button>
        </div>
      `;
      list.appendChild(li);
    });
}

function renderProjectFiles(project) {
  const list = $("projectFileList");
  if (!list) return;

  list.innerHTML = "";

  project.files.forEach(file => {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `
      <div class="item-main">
        <strong>${file.name}</strong>
        <small>${file.type || "File"} · ${formatFileSize(file.size)}</small>
      </div>
      <div class="actions">
        <button class="delete" onclick="deleteProjectFile('${project.id}', '${file.id}')">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function formatFileSize(size) {
  if (!size) return "Unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function createProject(name) {
  projects.push({
    id: uid(),
    name,
    notes: "",
    todos: [],
    events: [],
    files: [],
    githubRepo: "",
    githubData: null
  });

  renderProjects();
}

function addProjectTodo(projectId, text) {
  const project = projects.find(project => project.id === projectId);
  if (!project) return;

  project.todos.push({ id: uid(), text, done: false });
  renderProjects();
}

function toggleProjectTodo(projectId, todoId) {
  const project = projects.find(project => project.id === projectId);
  if (!project) return;

  const todo = project.todos.find(todo => todo.id === todoId);
  if (!todo) return;

  todo.done = !todo.done;
  renderProjects();
}

function deleteProjectTodo(projectId, todoId) {
  const project = projects.find(project => project.id === projectId);
  if (!project) return;

  project.todos = project.todos.filter(todo => todo.id !== todoId);
  renderProjects();
}

function addProjectEvent(projectId, title, date, time) {
  const project = projects.find(project => project.id === projectId);
  if (!project) return;

  const eventId = uid();

  project.events.push({
    id: eventId,
    title,
    date,
    time,
    projectId,
    projectName: project.name
  });

  const lifeEvent = {
    id: `project-${eventId}`,
    title: `${project.name}: ${title}`,
    date,
    time,
    repeat: "none",
    repeatUntil: "",
    projectId,
    projectEventId: eventId,
    source: "life-command"
  };

  calendar.push(lifeEvent);

  addEventToGoogleCalendar(lifeEvent)
    .then(googleEvent => {
      if (googleEvent) {
        lifeEvent.id = `google-${googleEvent.id}`;
        lifeEvent.source = "google";
        lifeEvent.googleId = googleEvent.id;
        lifeEvent.googleHtmlLink = googleEvent.htmlLink || "";
        setGoogleStatus("Project event added to Google");
        render();
      }
    })
    .catch(() => {
      setGoogleStatus("Project event saved locally");
    });

  render();
}

function deleteProjectEvent(projectId, eventId) {
  const project = projects.find(project => project.id === projectId);
  if (!project) return;

  project.events = project.events.filter(event => event.id !== eventId);
  calendar = calendar.filter(event => event.projectEventId !== eventId);
  render();
}

function addProjectFiles(projectId, files) {
  const project = projects.find(project => project.id === projectId);
  if (!project) return;

  Array.from(files).forEach(file => {
    project.files.push({
      id: uid(),
      name: file.name,
      type: file.type,
      size: file.size,
      added: new Date().toISOString()
    });
  });

  renderProjects();
}

function deleteProjectFile(projectId, fileId) {
  const project = projects.find(project => project.id === projectId);
  if (!project) return;

  project.files = project.files.filter(file => file.id !== fileId);
  renderProjects();
}

/* GitHub integration */
function parseGithubRepo(input) {
  const cleaned = input.trim();
  if (!cleaned) return "";

  if (cleaned.includes("github.com")) {
    try {
      const url = new URL(cleaned);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1].replace(".git", "")}`;
    } catch (error) {
      return "";
    }
  }

  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 2) return `${parts[0]}/${parts[1].replace(".git", "")}`;
  return "";
}

async function connectProjectGithub(projectId, repoInput) {
  const project = projects.find(project => project.id === projectId);
  if (!project) return;

  const repo = parseGithubRepo(repoInput);
  const status = $("githubStatus");

  if (!repo) {
    if (status) status.innerHTML = `<div class="github-card"><strong>Invalid repo</strong><small>Use a GitHub URL or owner/repo format.</small></div>`;
    return;
  }

  project.githubRepo = repo;
  project.githubData = null;
  saveProjects();

  if (status) status.innerHTML = `<div class="github-card"><strong>Connecting...</strong><small>Fetching ${repo}</small></div>`;

  await loadProjectGithub(projectId);
}

async function loadProjectGithub(projectId) {
  const project = projects.find(project => project.id === projectId);
  if (!project || !project.githubRepo) {
    renderProjectGithub(project);
    return;
  }

  const status = $("githubStatus");

  try {
    const response = await fetch(`https://api.github.com/repos/${project.githubRepo}?cache_bust=${Date.now()}`, {
      cache: "no-store",
      headers: { "Accept": "application/vnd.github+json" }
    });

    if (!response.ok) throw new Error("GitHub repo could not be loaded");

    const repo = await response.json();
    let lastCommit = null;

    try {
      const commitsResponse = await fetch(`https://api.github.com/repos/${project.githubRepo}/commits?per_page=1&cache_bust=${Date.now()}`, {
        cache: "no-store",
        headers: { "Accept": "application/vnd.github+json" }
      });

      if (commitsResponse.ok) {
        const commits = await commitsResponse.json();
        if (commits.length > 0) {
          lastCommit = {
            message: commits[0].commit.message,
            author: commits[0].commit.author.name,
            date: commits[0].commit.author.date,
            url: commits[0].html_url,
            sha: commits[0].sha.slice(0, 7)
          };
        }
      }
    } catch (commitError) {
      lastCommit = null;
    }

    project.githubData = {
      fullName: repo.full_name,
      description: repo.description,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      language: repo.language,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at || (lastCommit ? lastCommit.date : null),
      htmlUrl: repo.html_url,
      lastCommit
    };

    saveProjects();
    renderProjectGithub(project);
  } catch (error) {
    if (status) {
      status.innerHTML = `
        <div class="github-card">
          <strong>GitHub unavailable</strong>
          <small>Check the repo name, your internet, or GitHub rate limits.</small>
          <button type="button" onclick="loadProjectGithub('${project.id}')">Try Again</button>
        </div>
      `;
    }
  }
}

function getRepoPushStatus(pushedAt) {
  if (!pushedAt) return { icon: "❌", label: "No push data", className: "status-red" };

  const pushedDate = new Date(pushedAt);
  const now = new Date();
  const hoursSincePush = (now - pushedDate) / (1000 * 60 * 60);

  if (hoursSincePush <= 48) return { icon: "✅", label: "Recently pushed", className: "status-green" };
  if (hoursSincePush <= 168) return { icon: "⚠️", label: "Getting stale", className: "status-yellow" };
  return { icon: "❌", label: "Needs push", className: "status-red" };
}

function formatGithubDate(dateText) {
  if (!dateText) return "Unknown";
  return new Date(dateText).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getRelativeGithubTime(dateText) {
  if (!dateText) return "unknown";

  const date = new Date(dateText);
  const now = new Date();
  const minutes = Math.floor((now - date) / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  return `${days} days ago`;
}

function renderProjectGithub(project) {
  const status = $("githubStatus");
  const input = $("projectGithubRepo");

  if (!status || !project) return;

  if (input) input.value = project.githubRepo || "";

  if (!project.githubRepo) {
    status.innerHTML = `<p>No repo connected yet.</p>`;
    return;
  }

  if (!project.githubData) {
    status.innerHTML = `
      <div class="github-card">
        <strong>${project.githubRepo}</strong>
        <small>Repo connected. Fetching GitHub data...</small>
        <button type="button" onclick="loadProjectGithub('${project.id}')">Refresh GitHub</button>
      </div>
    `;
    loadProjectGithub(project.id);
    return;
  }

  const data = project.githubData;
  const pushStatus = getRepoPushStatus(data.pushedAt);
  const lastCommitDate = data.lastCommit ? formatGithubDate(data.lastCommit.date) : "No commit found";
  const lastCommitRelative = data.lastCommit ? getRelativeGithubTime(data.lastCommit.date) : "unknown";
  const pushedRelative = getRelativeGithubTime(data.pushedAt);

  status.innerHTML = `
    <div class="github-card">
      <div class="github-card-top">
        <div>
          <strong>${data.fullName}</strong>
          <small>${data.description || "No description"}</small>
        </div>
        <div class="push-status ${pushStatus.className}">
          <span>${pushStatus.icon}</span>
          <small>${pushStatus.label}</small>
        </div>
      </div>

      <div class="github-stats">
        <div><span>${data.stars}</span><small>Stars</small></div>
        <div><span>${data.forks}</span><small>Forks</small></div>
        <div><span>${data.openIssues}</span><small>Issues</small></div>
      </div>

      <div class="github-detail-grid">
        <div>
          <small>Last Commit</small>
          <strong>${lastCommitDate}</strong>
          <p>${lastCommitRelative}</p>
        </div>
        <div>
          <small>Push Status</small>
          <strong>${pushStatus.icon} ${pushStatus.label}</strong>
          <p>Last push ${pushedRelative}</p>
        </div>
        <div>
          <small>Open Issues</small>
          <strong>${data.openIssues}</strong>
          <p>${data.openIssues === 0 ? "No open issues" : "Issues need review"}</p>
        </div>
      </div>

      ${data.lastCommit ? `
        <div class="github-commit">
          <small>Latest Commit</small>
          <strong>${data.lastCommit.sha}</strong>
          <p>${data.lastCommit.message}</p>
          <small>By ${data.lastCommit.author}</small>
        </div>
      ` : ""}

      <p>Language: ${data.language || "Unknown"}</p>
      <div class="github-actions">
        <a class="github-link" href="${data.htmlUrl}" target="_blank" rel="noopener noreferrer">Open Repo</a>
        <button type="button" onclick="loadProjectGithub('${project.id}')">Refresh GitHub</button>
      </div>
    </div>
  `;
}

/* Rolling log */
function addLogEntry(type, body) {
  const now = new Date();
  rollingLog.unshift({
    id: uid(),
    type,
    body,
    timestamp: now.toISOString(),
    dateKey: formatDateInput(now)
  });
  render();
}

function deleteLogEntry(id) {
  rollingLog = rollingLog.filter(entry => entry.id !== id);
  render();
}

function renderRollingLog() {
  const list = $("logList");
  if (!list) return;

  list.innerHTML = "";

  if (rollingLog.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.textContent = "No log entries yet. Add a journal entry, observation, idea, or lesson learned.";
    list.appendChild(empty);
    return;
  }

  const sortedEntries = [...rollingLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  let currentDate = "";

  sortedEntries.forEach(entry => {
    if (entry.dateKey !== currentDate) {
      currentDate = entry.dateKey;
      const heading = document.createElement("div");
      heading.className = "log-date-heading";
      heading.textContent = formatTimelineDate(entry.dateKey);
      list.appendChild(heading);
    }

    const date = new Date(entry.timestamp);
    const time = date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit"
    });

    const card = document.createElement("div");
    card.className = "log-entry";
    card.innerHTML = `
      <div class="log-meta">
        <span class="log-time">${time}</span>
        <span class="log-type">${entry.type}</span>
      </div>
      <div class="log-body">${entry.body}</div>
      <div class="actions">
        <button class="delete" onclick="deleteLogEntry('${entry.id}')">Delete</button>
      </div>
    `;

    list.appendChild(card);
  });
}

/* Google Calendar */
function getGoogleSettings() {
  return {
    clientId: localStorage.getItem("lifeCommand.googleClientId") || "",
    apiKey: localStorage.getItem("lifeCommand.googleApiKey") || "",
    calendarId: localStorage.getItem("lifeCommand.googleCalendarId") || "primary",
    pushEvents: localStorage.getItem("lifeCommand.pushEventsToGoogle") !== "false"
  };
}

function setGoogleStatus(message) {
  safeText("googleCalendarStatus", message);
}

window.gapiLoaded = function gapiLoaded() {
  if (!window.gapi) return;
  gapi.load("client", initializeGoogleApiClient);
};

window.gisLoaded = function gisLoaded() {
  gisInited = true;
  initializeGoogleTokenClient();
};

async function initializeGoogleApiClient() {
  const settings = getGoogleSettings();

  if (!settings.apiKey || !window.gapi) {
    gapiInited = true;
    setGoogleStatus("Add API key in Settings");
    return;
  }

  try {
    await gapi.client.init({
      apiKey: settings.apiKey,
      discoveryDocs: [GOOGLE_DISCOVERY_DOC]
    });

    gapiInited = true;
    googleCalendarReady = true;
    setGoogleStatus("Google API ready");
  } catch (error) {
    gapiInited = true;
    googleCalendarReady = false;
    setGoogleStatus("Google API setup failed");
  }
}

function initializeGoogleTokenClient() {
  const settings = getGoogleSettings();

  if (!settings.clientId || !window.google?.accounts?.oauth2) {
    setGoogleStatus("Add Client ID in Settings");
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: settings.clientId,
    scope: GOOGLE_SCOPES,
    callback: ""
  });

  setGoogleStatus(gapiInited && googleCalendarReady ? "Ready to connect" : "Saved settings");
}

function saveGoogleCalendarSettings() {
  const clientId = $("googleClientId") ? $("googleClientId").value.trim() : "";
  const apiKey = $("googleApiKey") ? $("googleApiKey").value.trim() : "";
  const calendarId = $("googleCalendarId") ? $("googleCalendarId").value.trim() : "primary";
  const pushEvents = $("pushEventsToGoogle") ? $("pushEventsToGoogle").checked : true;

  localStorage.setItem("lifeCommand.googleClientId", clientId);
  localStorage.setItem("lifeCommand.googleApiKey", apiKey);
  localStorage.setItem("lifeCommand.googleCalendarId", calendarId || "primary");
  localStorage.setItem("lifeCommand.pushEventsToGoogle", String(pushEvents));

  setGoogleStatus("Settings saved. Reloading...");
  setTimeout(() => window.location.reload(), 350);
}

function loadGoogleSettingsIntoForm() {
  const settings = getGoogleSettings();

  if ($("googleClientId")) $("googleClientId").value = settings.clientId;
  if ($("googleApiKey")) $("googleApiKey").value = settings.apiKey;
  if ($("googleCalendarId")) $("googleCalendarId").value = settings.calendarId;
  if ($("pushEventsToGoogle")) $("pushEventsToGoogle").checked = settings.pushEvents;
}

async function connectGoogleCalendar() {
  const settings = getGoogleSettings();

  if (!settings.clientId || !settings.apiKey) {
    setGoogleStatus("Missing Client ID/API key");
    return;
  }

  if (!tokenClient) initializeGoogleTokenClient();

  if (!tokenClient || !window.gapi?.client) {
    setGoogleStatus("Google auth not ready");
    return;
  }

  tokenClient.callback = async (resp) => {
    if (resp.error) {
      setGoogleStatus("Authorization failed");
      return;
    }

    setGoogleStatus("Connected");
    await syncGoogleCalendarEvents();
  };

  const currentToken = gapi.client.getToken();
  tokenClient.requestAccessToken({ prompt: currentToken ? "" : "consent" });
}

function disconnectGoogleCalendar() {
  if (!window.gapi?.client) {
    setGoogleStatus("Disconnected");
    return;
  }

  const token = gapi.client.getToken();

  if (token && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken("");
  }

  setGoogleStatus("Disconnected");
}

async function syncGoogleCalendarEvents() {
  if (!window.gapi?.client || !gapiInited || !googleCalendarReady || !gapi.client.getToken()) {
    setGoogleStatus("Connect first");
    return;
  }

  const settings = getGoogleSettings();
  setGoogleStatus("Syncing...");

  try {
    const response = await gapi.client.calendar.events.list({
      calendarId: settings.calendarId,
      timeMin: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
      showDeleted: false,
      singleEvents: true,
      maxResults: 50,
      orderBy: "startTime"
    });

    const googleEvents = response.result.items || [];
    calendar = calendar.filter(event => event.source !== "google");

    googleEvents.forEach(event => {
      const start = event.start.dateTime || event.start.date;
      const parsed = parseGoogleEventStart(start);

      calendar.push({
        id: `google-${event.id}`,
        title: event.summary || "Untitled Google Event",
        date: parsed.date,
        time: parsed.time,
        repeat: "none",
        repeatUntil: "",
        source: "google",
        googleId: event.id,
        googleHtmlLink: event.htmlLink || ""
      });
    });

    render();
    setGoogleStatus(`Synced ${googleEvents.length} events`);
  } catch (error) {
    setGoogleStatus("Sync failed");
  }
}

function parseGoogleEventStart(startText) {
  if (!startText.includes("T")) return { date: startText, time: "" };

  const date = new Date(startText);
  return {
    date: formatDateInput(date),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  };
}

function buildGoogleEventBody(event) {
  const timeZone = "America/Denver";

  if (!event.time) {
    const start = new Date(event.date + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return {
      summary: event.title,
      start: { date: event.date },
      end: { date: formatDateInput(end) }
    };
  }

  const startDate = new Date(`${event.date}T${event.time}`);
  const endDate = event.endTime
    ? new Date(`${event.date}T${event.endTime}`)
    : new Date(startDate.getTime() + 60 * 60 * 1000);

  return {
    summary: event.title,
    start: { dateTime: startDate.toISOString(), timeZone },
    end: { dateTime: endDate.toISOString(), timeZone }
  };
}

async function addEventToGoogleCalendar(event) {
  const settings = getGoogleSettings();

  if (!settings.pushEvents || !window.gapi?.client || !gapiInited || !googleCalendarReady || !gapi.client.getToken()) {
    return null;
  }

  const response = await gapi.client.calendar.events.insert({
    calendarId: settings.calendarId,
    resource: buildGoogleEventBody(event)
  });

  return response.result;
}

async function deleteEventFromGoogleCalendar(event) {
  const settings = getGoogleSettings();

  if (!event?.googleId || !window.gapi?.client || !gapiInited || !googleCalendarReady || !gapi.client.getToken()) return;

  try {
    await gapi.client.calendar.events.delete({
      calendarId: settings.calendarId,
      eventId: event.googleId
    });
    setGoogleStatus("Deleted from Google");
  } catch (error) {
    setGoogleStatus("Local delete only");
  }
}

/* Space dashboard */
function openSpaceDashboard() {
  closeSettingsPage();
  document.body.classList.add("space-dashboard-open");

  const page = $("spaceDashboardPage");
  if (page) page.classList.remove("hidden");

  loadSpaceDashboard();
}

function closeSpaceDashboard() {
  document.body.classList.remove("space-dashboard-open");

  const page = $("spaceDashboardPage");
  if (page) page.classList.add("hidden");
}

async function loadSpaceDashboard() {
  await Promise.allSettled([
    loadUpcomingLaunches()
  ]);
}

function getLaunchProvider(launch) {
  return launch.launch_service_provider?.name ||
    launch.rocket?.configuration?.manufacturer?.name ||
    launch.rocket?.configuration?.name ||
    "Provider TBD";
}

function getLaunchPad(launch) {
  return launch.pad?.name ||
    "Pad TBD";
}

function getLaunchLocation(launch) {
  return launch.pad?.location?.name ||
    launch.location?.name ||
    launch.pad?.country_code ||
    "Location TBD";
}

async function loadUpcomingLaunches() {
  const launchList = $("launchList");
  const countdown = $("nextLaunchCountdown");
  const details = $("nextLaunchDetails");

  if (launchList) launchList.innerHTML = `<div class="space-empty">Fetching upcoming launches...</div>`;

  try {
    const response = await fetch(LAUNCH_LIBRARY_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Launch fetch failed");

    const data = await response.json();
    spaceLaunches = data.results || [];

    renderLaunches();

    if (spaceLaunches.length > 0) {
      renderNextLaunch(spaceLaunches[0]);
    } else {
      if (countdown) countdown.textContent = "No upcoming launches found";
      if (details) details.textContent = "Launch Library returned no upcoming launch data.";
    }
  } catch (error) {
    if (launchList) launchList.innerHTML = `<div class="space-empty">Launch data unavailable. Try refreshing later.</div>`;
    if (countdown) countdown.textContent = "Launch data unavailable";
    if (details) details.textContent = "Could not reach Launch Library 2.";
  }
}

function renderNextLaunch(launch) {
  const countdown = $("nextLaunchCountdown");
  const details = $("nextLaunchDetails");
  if (!countdown || !details) return;

  countdown.textContent = getLaunchCountdownText(launch.net);

  const provider = getLaunchProvider(launch);
  const pad = getLaunchPad(launch);
  const location = getLaunchLocation(launch);
  const status = launch.status?.name || "Status TBD";

  details.innerHTML = `
    <strong>${launch.name}</strong><br>
    ${provider} · ${status}<br>
    ${formatSpaceDate(launch.net)}<br>
    ${pad}, ${location}
  `;
}

function renderLaunches() {
  const launchList = $("launchList");
  if (!launchList) return;

  launchList.innerHTML = "";

  spaceLaunches.forEach(launch => {
    const item = document.createElement("div");
    item.className = "space-item";

    const provider = getLaunchProvider(launch);
    const location = getLaunchLocation(launch);
    const status = launch.status?.name || "Status TBD";
    const statusClass = status.toLowerCase().includes("go") ? "launch-status-go" :
      status.toLowerCase().includes("hold") ? "launch-status-hold" : "launch-status-tbd";

    item.innerHTML = `
      <strong>${launch.name}</strong>
      <small>${provider} · ${location}</small>
      <small><span class="${statusClass}">${status}</span></small>
      <small>${formatSpaceDate(launch.net)}</small>
      <small>${getLaunchCountdownText(launch.net)}</small>
    `;

    launchList.appendChild(item);
  });
}

function getLaunchCountdownText(dateText) {
  if (!dateText) return "TBD";

  const launchDate = new Date(dateText);
  const now = new Date();
  const diffMs = launchDate - now;

  if (diffMs <= 0) return "Launch time has passed or is live";

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `T-${days} days ${hours} hours`;
  return `T-${hours} hours ${minutes} minutes`;
}

function formatSpaceDate(dateText) {
  if (!dateText) return "Date TBD";

  return new Date(dateText).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getSpaceSettings() {
  return {
    issPassApiUrl: localStorage.getItem("lifeCommand.issPassApiUrl") || ""
  };
}

function loadSpaceSettingsIntoForm() {
  const settings = getSpaceSettings();
  if ($("issPassApiUrl")) $("issPassApiUrl").value = settings.issPassApiUrl;
}

function saveSpaceSettings() {
  const issPassApiUrl = $("issPassApiUrl") ? $("issPassApiUrl").value.trim() : "";
  localStorage.setItem("lifeCommand.issPassApiUrl", issPassApiUrl);

  const button = $("saveSpaceSettings");
  if (button) {
    button.textContent = "Saved";
    setTimeout(() => button.textContent = "Save Space Settings", 900);
  }
}

async function loadIssPasses() {
  const target = $("issPassList");
  if (!target) return;

  const settings = getSpaceSettings();

  if (!settings.issPassApiUrl) {
    target.innerHTML = `<div class="space-empty">Add an ISS pass API URL in Settings to load overhead passes here.</div>`;
    return;
  }

  target.innerHTML = `<div class="space-empty">Fetching ISS passes...</div>`;

  try {
    const response = await fetch(settings.issPassApiUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("ISS pass fetch failed");

    const data = await response.json();
    const passes = Array.isArray(data) ? data : (data.passes || data.response || data.results || []);

    if (!passes.length) {
      target.innerHTML = `<div class="space-empty">No ISS passes found from this API response.</div>`;
      return;
    }

    target.innerHTML = "";

    passes.slice(0, 5).forEach(pass => {
      const riseTime = pass.risetime || pass.start || pass.startTime || pass.time || pass.date;
      const duration = pass.duration || pass.durationSeconds || pass.length || "Unknown duration";
      const date = typeof riseTime === "number" ? new Date(riseTime * 1000) : new Date(riseTime);

      const item = document.createElement("div");
      item.className = "space-item";
      item.innerHTML = `
        <strong>${Number.isNaN(date.getTime()) ? "Upcoming ISS Pass" : formatSpaceDate(date.toISOString())}</strong>
        <small>Duration: ${duration}</small>
      `;

      target.appendChild(item);
    });
  } catch (error) {
    target.innerHTML = `<div class="space-empty">ISS pass API failed. Check the URL in Settings.</div>`;
  }
}




/* Settings */
function openSettingsPage() {
  closeSpaceDashboard();
  document.body.classList.add("settings-open");

  const settingsPage = $("settingsPage");
  if (settingsPage) settingsPage.classList.remove("hidden");

  loadGoogleSettingsIntoForm();
  loadSpaceSettingsIntoForm();
}

function closeSettingsPage() {
  document.body.classList.remove("settings-open");

  const settingsPage = $("settingsPage");
  if (settingsPage) settingsPage.classList.add("hidden");
}

/* Themes */
function applyTheme(themeName) {
  const themes = ["mission-control", "shuttle-era", "deep-space", "iss", "apollo-crt"];
  const safeTheme = themes.includes(themeName) ? themeName : "mission-control";

  themes.forEach(theme => {
    document.body.classList.remove(`theme-${theme}`);
    document.documentElement.classList.remove(`theme-${theme}`);
  });

  document.body.classList.add(`theme-${safeTheme}`);
  document.documentElement.classList.add(`theme-${safeTheme}`);
  document.body.setAttribute("data-theme", safeTheme);
  document.documentElement.setAttribute("data-theme", safeTheme);

  const themeSelect = $("themeSelect");
  if (themeSelect) themeSelect.value = safeTheme;
}

function saveTheme() {
  const themeSelect = $("themeSelect");
  const selectedTheme = themeSelect ? themeSelect.value : "mission-control";
  localStorage.setItem("lifeCommand.theme", selectedTheme);
  applyTheme(selectedTheme);

  const saveThemeButton = $("saveThemeButton");
  if (saveThemeButton) saveThemeButton.textContent = "Saved";

  setTimeout(() => window.location.reload(), 250);
}

function loadSavedTheme() {
  const savedTheme = localStorage.getItem("lifeCommand.theme") || "mission-control";
  applyTheme(savedTheme);
}

/* Mutations */
async function removeCalendar(id) {
  const removedEvent = calendar.find(event => event.id === id);
  await deleteEventFromGoogleCalendar(removedEvent);

  if (removedEvent && removedEvent.projectEventId) {
    const project = projects.find(project => project.id === removedEvent.projectId);
    if (project) project.events = project.events.filter(event => event.id !== removedEvent.projectEventId);
  }

  calendar = calendar.filter(event => event.id !== id);
  render();
}

function removeHomework(id) {
  homework = homework.filter(task => task.id !== id);
  render();
}

function toggleItem(type, id) {
  const list = type === "todos" ? todos : shopping;
  const item = list.find(item => item.id === id);
  if (!item) return;

  item.done = !item.done;
  render();
}

function deleteItem(type, id) {
  if (type === "todos") {
    todos = todos.filter(item => item.id !== id);
  } else {
    shopping = shopping.filter(item => item.id !== id);
  }

  render();
}

function toggleRepeatUntilField() {
  const repeatSelect = $("eventRepeat");
  const repeatWrap = $("repeatUntilWrap");

  if (!repeatSelect || !repeatWrap) return;

  if (repeatSelect.value === "none") {
    repeatWrap.classList.add("hidden");
    if ($("eventRepeatUntil")) $("eventRepeatUntil").value = "";
  } else {
    repeatWrap.classList.remove("hidden");
  }
}

function updateSpaceCountdown() {
  if (document.body.classList.contains("space-dashboard-open") && spaceLaunches.length > 0) {
    renderNextLaunch(spaceLaunches[0]);
  }
}

function bindForms() {
  loadGoogleSettingsIntoForm();
  loadSpaceSettingsIntoForm();

  const themeSelect = $("themeSelect");
  if (themeSelect) themeSelect.value = localStorage.getItem("lifeCommand.theme") || "mission-control";

  const saveThemeButton = $("saveThemeButton");
  if (saveThemeButton) saveThemeButton.addEventListener("click", saveTheme);

  const homeButton = $("homeButton");
  if (homeButton) homeButton.addEventListener("click", closeProjectWorkspace);

  const settingsButton = $("settingsButton");
  if (settingsButton) settingsButton.addEventListener("click", openSettingsPage);

  const closeSettings = $("closeSettings");
  if (closeSettings) closeSettings.addEventListener("click", closeSettingsPage);

  const saveGoogleSettings = $("saveGoogleSettings");
  if (saveGoogleSettings) saveGoogleSettings.addEventListener("click", saveGoogleCalendarSettings);

  const connectGoogle = $("connectGoogleCalendar");
  if (connectGoogle) connectGoogle.addEventListener("click", connectGoogleCalendar);

  const syncGoogle = $("syncGoogleCalendar");
  if (syncGoogle) syncGoogle.addEventListener("click", syncGoogleCalendarEvents);

  const disconnectGoogle = $("disconnectGoogleCalendar");
  if (disconnectGoogle) disconnectGoogle.addEventListener("click", disconnectGoogleCalendar);

  const saveSpaceSettingsButton = $("saveSpaceSettings");
  if (saveSpaceSettingsButton) saveSpaceSettingsButton.addEventListener("click", saveSpaceSettings);

  const spaceDashboardButton = $("spaceDashboardButton");
  if (spaceDashboardButton) spaceDashboardButton.addEventListener("click", openSpaceDashboard);

  const closeSpaceButton = $("closeSpaceDashboard");
  if (closeSpaceButton) closeSpaceButton.addEventListener("click", closeSpaceDashboard);

  const refreshSpaceButton = $("refreshSpaceData");
  if (refreshSpaceButton) refreshSpaceButton.addEventListener("click", loadSpaceDashboard);

  const eventRepeat = $("eventRepeat");
  if (eventRepeat) {
    eventRepeat.addEventListener("change", toggleRepeatUntilField);
    toggleRepeatUntilField();
  }

  const calendarForm = $("calendarForm");
  if (calendarForm) {
    calendarForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const lifeEvent = {
        id: uid(),
        title: $("eventTitle").value.trim(),
        date: $("eventDate").value,
        time: $("eventTime").value,
        endTime: $("eventEndTime") ? $("eventEndTime").value : "",
        repeat: $("eventRepeat") ? $("eventRepeat").value : "none",
        repeatUntil: $("eventRepeatUntil") ? $("eventRepeatUntil").value : "",
        source: "life-command"
      };

      try {
        const googleEvent = await addEventToGoogleCalendar(lifeEvent);

        if (googleEvent) {
          lifeEvent.id = `google-${googleEvent.id}`;
          lifeEvent.source = "google";
          lifeEvent.googleId = googleEvent.id;
          lifeEvent.googleHtmlLink = googleEvent.htmlLink || "";
          setGoogleStatus("Event added to Google");
        }
      } catch (error) {
        setGoogleStatus("Google insert failed. Saved locally.");
      }

      calendar.push(lifeEvent);
      e.target.reset();
      toggleRepeatUntilField();
      render();
    });
  }

  const homeworkForm = $("homeworkForm");
  if (homeworkForm) {
    homeworkForm.addEventListener("submit", (e) => {
      e.preventDefault();

      homework.push({
        id: uid(),
        className: $("homeworkClass").value.trim(),
        task: $("homeworkTask").value.trim(),
        due: $("homeworkDue").value,
        dueTime: $("homeworkDueTime") ? $("homeworkDueTime").value : ""
      });

      e.target.reset();
      render();
    });
  }

  const todoForm = $("todoForm");
  if (todoForm) {
    todoForm.addEventListener("submit", (e) => {
      e.preventDefault();

      todos.push({
        id: uid(),
        text: $("todoInput").value.trim(),
        priority: $("todoPriority") ? $("todoPriority").value : "important",
        done: false
      });

      e.target.reset();
      render();
    });
  }

  const shoppingForm = $("shoppingForm");
  if (shoppingForm) {
    shoppingForm.addEventListener("submit", (e) => {
      e.preventDefault();
      shopping.push({ id: uid(), text: $("shoppingInput").value.trim(), done: false });
      e.target.reset();
      render();
    });
  }

  const refreshWeather = $("refreshWeather");
  if (refreshWeather) refreshWeather.addEventListener("click", loadWeather);

  const projectForm = $("projectForm");
  if (projectForm) {
    projectForm.addEventListener("submit", (e) => {
      e.preventDefault();
      createProject($("projectName").value.trim());
      e.target.reset();
    });
  }

  const closeProject = $("closeProject");
  if (closeProject) closeProject.addEventListener("click", closeProjectWorkspace);

  const projectTodoForm = $("projectTodoForm");
  if (projectTodoForm) {
    projectTodoForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const project = getActiveProject();
      if (!project) return;

      addProjectTodo(project.id, $("projectTodoInput").value.trim());
      e.target.reset();
    });
  }

  const projectEventForm = $("projectEventForm");
  if (projectEventForm) {
    projectEventForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const project = getActiveProject();
      if (!project) return;

      addProjectEvent(project.id, $("projectEventTitle").value.trim(), $("projectEventDate").value, $("projectEventTime").value);
      e.target.reset();
    });
  }

  const projectNotesArea = $("projectNotesArea");
  if (projectNotesArea) {
    projectNotesArea.addEventListener("input", () => {
      const project = getActiveProject();
      if (!project) return;

      project.notes = projectNotesArea.value;
      saveProjects();
    });
  }

  const projectFileInput = $("projectFileInput");
  if (projectFileInput) {
    projectFileInput.addEventListener("change", (e) => {
      const project = getActiveProject();
      if (!project) return;

      addProjectFiles(project.id, e.target.files);
      e.target.value = "";
    });
  }

  const fileDropZone = $("fileDropZone");
  if (fileDropZone) {
    fileDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      fileDropZone.classList.add("dragging");
    });

    fileDropZone.addEventListener("dragleave", () => {
      fileDropZone.classList.remove("dragging");
    });

    fileDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      fileDropZone.classList.remove("dragging");

      const project = getActiveProject();
      if (!project) return;

      addProjectFiles(project.id, e.dataTransfer.files);
    });
  }

  const projectGithubForm = $("projectGithubForm");
  if (projectGithubForm) {
    projectGithubForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const project = getActiveProject();
      if (!project) return;

      await connectProjectGithub(project.id, $("projectGithubRepo").value);
    });
  }

  const logForm = $("logForm");
  if (logForm) {
    logForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addLogEntry($("logType").value, $("logEntryInput").value.trim());
      e.target.reset();
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadSavedTheme();
  bindForms();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateSpaceCountdown, 60000);
  render();
  loadWeather();
});
