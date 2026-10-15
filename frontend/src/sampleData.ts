/** Stand-in content for the shell. Swap these for API data as the backend fills in. */

export type Pace = "easy" | "steady" | "hard";

export type WildCampTripStop = {
  name: string;
  latitude: number;
  longitude: number;
  score: number;
  category: "Poor" | "Moderate" | "Promising";
};

export type PlannerSeed = {
  start: string;
  finish: string;
  days: number;
  pace?: Pace;
  wildCampStop?: WildCampTripStop;
};

export type SuggestedTrip = PlannerSeed & {
  name: string;
  detail: string;
};

export type NearbyStayType = "Bothy" | "Campsite" | "Hostel" | "Hotel";

export type NearbyStay = {
  id: string;
  type: NearbyStayType;
  name: string;
  rating: number;
  reviewCount: number;
  distance: string;
  availability: string;
};

/** Fallback nearby-stay results shown before an endpoint search or if the API is unavailable. */
export const nearbyStayOptions: NearbyStay[][] = [
  [
    {
      id: "lochside-bothy",
      type: "Bothy",
      name: "Lochside Bothy",
      rating: 4.8,
      reviewCount: 96,
      distance: "1.2 km away",
      availability: "Free to use",
    },
    {
      id: "pine-wood-campsite",
      type: "Campsite",
      name: "Pine Wood Campsite",
      rating: 4.6,
      reviewCount: 74,
      distance: "1.5 km away",
      availability: "Pitches to check",
    },
    {
      id: "glen-way-hostel",
      type: "Hostel",
      name: "Glen Way Hostel",
      rating: 4.7,
      reviewCount: 211,
      distance: "2.1 km away",
      availability: "Book ahead",
    },
    {
      id: "moorland-inn",
      type: "Hotel",
      name: "The Moorland Inn",
      rating: 4.5,
      reviewCount: 318,
      distance: "3.4 km away",
      availability: "Rooms to check",
    },
  ],
  [
    {
      id: "ridge-end-bothy",
      type: "Bothy",
      name: "Ridge End Bothy",
      rating: 4.7,
      reviewCount: 82,
      distance: "0.8 km away",
      availability: "Free to use",
    },
    {
      id: "waterfall-campsite",
      type: "Campsite",
      name: "Waterfall Campsite",
      rating: 4.5,
      reviewCount: 128,
      distance: "1.1 km away",
      availability: "Pitches to check",
    },
    {
      id: "corrie-hostel",
      type: "Hostel",
      name: "Corrie Hostel",
      rating: 4.8,
      reviewCount: 167,
      distance: "2.4 km away",
      availability: "Book ahead",
    },
    {
      id: "station-house-hotel",
      type: "Hotel",
      name: "Station House Hotel",
      rating: 4.4,
      reviewCount: 256,
      distance: "3.1 km away",
      availability: "Rooms to check",
    },
  ],
  [
    {
      id: "river-bend-bothy",
      type: "Bothy",
      name: "River Bend Bothy",
      rating: 4.6,
      reviewCount: 64,
      distance: "1.0 km away",
      availability: "Free to use",
    },
    {
      id: "loch-view-campsite",
      type: "Campsite",
      name: "Loch View Campsite",
      rating: 4.7,
      reviewCount: 143,
      distance: "1.7 km away",
      availability: "Pitches to check",
    },
    {
      id: "trailhead-hostel",
      type: "Hostel",
      name: "Trailhead Hostel",
      rating: 4.5,
      reviewCount: 189,
      distance: "2.2 km away",
      availability: "Book ahead",
    },
    {
      id: "highland-lodge",
      type: "Hotel",
      name: "Highland Lodge",
      rating: 4.6,
      reviewCount: 402,
      distance: "4.0 km away",
      availability: "Rooms to check",
    },
  ],
];

export const suggestedTrips: SuggestedTrip[] = [
  {
    name: "Ossian overnight",
    start: "Corrour station",
    finish: "Dalwhinnie",
    days: 2,
    detail: "Corrour bothy",
  },
  {
    name: "Knoydart crossing",
    start: "Kinloch Hourn",
    finish: "Inverie",
    days: 3,
    detail: "Sourlies and Barrisdale",
  },
  {
    name: "Affric to Kintail",
    start: "Glen Affric",
    finish: "Morvich",
    days: 2,
    detail: "Camban and Alltbeithe",
  },
];

export const stats = [
  { label: "Routes", value: "6" },
  { label: "Distance", value: "186 km" },
  { label: "Bothies", value: "9" },
  { label: "Climbed", value: "4,280 m" },
];

export const badges = [
  { name: "First bothy", detail: "Night at Corrour", mark: "1" },
  { name: "Three-day stretch", detail: "Finished Knoydart", mark: "3" },
  { name: "Wet ridge", detail: "A full day of rain", mark: "R" },
  { name: "Early start", detail: "Away before sunrise", mark: "E" },
  { name: "Shared fire", detail: "Posted a bothy photo", mark: "F" },
  { name: "Regular", detail: "Five recorded trips", mark: "5" },
];

export const previousRoutes: SuggestedTrip[] = [
  {
    name: "Ossian overnight",
    start: "Corrour station",
    finish: "Dalwhinnie",
    days: 2,
    detail: "34 km · Corrour",
  },
  {
    name: "Knoydart crossing",
    start: "Kinloch Hourn",
    finish: "Inverie",
    days: 3,
    detail: "52 km · Sourlies, Barrisdale",
  },
  {
    name: "Affric to Kintail",
    start: "Glen Affric",
    finish: "Morvich",
    days: 2,
    detail: "38 km · Camban, Alltbeithe",
  },
];

export const friends = [
  { name: "Mairi Campbell", note: "Knoydart, last September", initials: "MC" },
  { name: "Jamie Ross", note: "Affric–Kintail in May", initials: "JR" },
  { name: "Priya Shah", note: "Corrour overnight", initials: "PS" },
  { name: "Owen Blake", note: "No trips together yet", initials: "OB" },
];

export const photos = [
  { caption: "Corrour at dusk", tint: "#3d5c49" },
  { caption: "Loch Nevis from the path", tint: "#1d4e5a" },
  { caption: "Wet boots at Sourlies", tint: "#6a5336" },
  { caption: "Ridge above Glen Affric", tint: "#31493d" },
  { caption: "Stove light, Barrisdale", tint: "#8d3f1c" },
  { caption: "Morning on the loch", tint: "#7d4e68" },
];

export type CommunityPost = {
  id: string;
  authorId?: string;
  author: string;
  when: string;
  title: string;
  body: string;
  tags: string[];
  tint: string;
  route?: PlannerSeed & { name: string };
};

export const communityPosts: CommunityPost[] = [
  {
    id: "knoydart",
    authorId: "mairi-campbell",
    author: "Mairi Campbell",
    when: "2 days ago",
    title: "Three nights into Knoydart",
    body: "Sourlies was full, so we slept in the other room and left before the rain sat down on the ridge. Inverie pie was worth the last miles.",
    tags: ["Knoydart", "Sourlies", "3 days"],
    tint: "#1d4e5a",
    route: { name: "Knoydart crossing", start: "Kinloch Hourn", finish: "Inverie", days: 3 },
  },
  {
    id: "ossian",
    authorId: "priya-shah",
    author: "Priya Shah",
    when: "Last week",
    title: "Ossian bothy in a west wind",
    body: "The train drops you at Corrour and the bothy is an easy evening. Dalwhinnie the next day is longer than it looks on the paper map.",
    tags: ["Corrour", "2 days"],
    tint: "#3d5c49",
    route: { name: "Ossian overnight", start: "Corrour station", finish: "Dalwhinnie", days: 2 },
  },
  {
    id: "affric",
    authorId: "jamie-ross",
    author: "Jamie Ross",
    when: "3 weeks ago",
    title: "Looking for a pair on the Affric–Kintail way",
    body: "Camban then Alltbeithe, starting Friday. Happy to keep it to two bothies if the weather turns.",
    tags: ["Glen Affric", "Partners"],
    tint: "#6a5336",
    route: { name: "Affric to Kintail", start: "Glen Affric", finish: "Morvich", days: 2 },
  },
  {
    id: "west-highland-way",
    authorId: "owen-blake",
    author: "Owen Blake",
    when: "1 month ago",
    title: "The last miles of the West Highland Way",
    body: "Kinlochleven to Fort William over the Mamores: a long day with a big finish.",
    tags: ["West Highland Way", "Mamores", "1 day"],
    tint: "#31493d",
    route: { name: "West Highland Way: Kinlochleven to Fort William", start: "Kinlochleven", finish: "Fort William", days: 1 },
  },
  {
    id: "great-glen-way",
    authorId: "mairi-campbell",
    author: "Mairi Campbell",
    when: "6 weeks ago",
    title: "Following the Great Glen north",
    body: "Fort William to Inverness following the Caledonian Canal and the lochside paths.",
    tags: ["Great Glen Way", "Loch Ness", "6 days"],
    tint: "#3d5c49",
    route: { name: "Great Glen Way", start: "Fort William", finish: "Inverness", days: 6 },
  },
  {
    id: "speyside-way",
    authorId: "priya-shah",
    author: "Priya Shah",
    when: "2 months ago",
    title: "A few days on the Speyside Way",
    body: "Aviemore to Grantown-on-Spey, with forest tracks and villages along the river.",
    tags: ["Speyside Way", "Cairngorms", "2 days"],
    tint: "#6a5336",
    route: { name: "Speyside Way: Aviemore to Grantown", start: "Aviemore", finish: "Grantown-on-Spey", days: 2 },
  },
  {
    id: "loch-mullardoch",
    authorId: "jamie-ross",
    author: "Jamie Ross",
    when: "2 months ago",
    title: "A quiet loop by Loch Mullardoch",
    body: "A weekend plan from Cannich towards the loch and back through Glen Cannich.",
    tags: ["Glen Cannich", "Weekend", "2 days"],
    tint: "#1d4e5a",
    route: { name: "Glen Cannich weekend", start: "Cannich", finish: "Tomich", days: 2 },
  },
  {
    id: "cairngorms-crossing",
    authorId: "owen-blake",
    author: "Owen Blake",
    when: "3 months ago",
    title: "Across the Cairngorms to Braemar",
    body: "A multi-day crossing from Aviemore via the Lairig Ghru to Braemar.",
    tags: ["Cairngorms", "Lairig Ghru", "3 days"],
    tint: "#8d3f1c",
    route: { name: "Cairngorms crossing", start: "Aviemore", finish: "Braemar", days: 3 },
  },
  {
    id: "ardnamurchan",
    authorId: "mairi-campbell",
    author: "Mairi Campbell",
    when: "4 months ago",
    title: "Out to the Ardnamurchan Point",
    body: "A coastal walk from Strontian through Salen to the lighthouse at the Point.",
    tags: ["Ardnamurchan", "Coast", "4 days"],
    tint: "#7d4e68",
    route: { name: "Ardnamurchan coast", start: "Strontian", finish: "Ardnamurchan Point Lighthouse", days: 4 },
  },
  {
    id: "trossachs",
    authorId: "priya-shah",
    author: "Priya Shah",
    when: "5 months ago",
    title: "A Trossachs weekend from Callander",
    body: "A two-day outing through the forest and loch country around Loch Katrine.",
    tags: ["Trossachs", "Loch Katrine", "2 days"],
    tint: "#31493d",
    route: { name: "Trossachs weekend", start: "Callander", finish: "Aberfoyle", days: 2 },
  },
];

export const communityUsers = [
  { id: "mairi-campbell", name: "Mairi Campbell", note: "Knoydart and west coast routes", initials: "MC" },
  { id: "priya-shah", name: "Priya Shah", note: "Bothy nights and long weekends", initials: "PS" },
  { id: "jamie-ross", name: "Jamie Ross", note: "Affric and Highland crossings", initials: "JR" },
  { id: "owen-blake", name: "Owen Blake", note: "Cairngorms and long distance paths", initials: "OB" },
];
