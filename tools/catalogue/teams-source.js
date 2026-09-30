'use strict';
/* The source for engine/catalogue-teams.js (#4555). Edit here, then run
     node tools/catalogue/build.js

   A team is a lead (slot 'lead') plus 4 or 5 reports. Each member names a role key (today's
   roles in engine/roles.js or the ones in roles-source.js), the team's title for that seat, a
   suggested agent name (the person can change it; unique across the whole catalogue, so two
   seeded teams can be made on one board with their defaults), what this member focuses on in
   THIS team, and a portrait spec. Portraits share one house style (AVATAR_STYLE) so a team looks
   like a set; the spec varies the person. */
module.exports = {
  // Shown on the team screen before the team is made (#4557): the one reach a team has that its
  // roles' own cautions do not state, because it comes from being a team.
  TEAM_CAUTION: "The lead briefs the rest of the team and checks their work on its own.",
  AVATAR_STYLE: "Photorealistic head-and-shoulders portrait of a fictional person, generated, not a real individual. Soft natural window light, shallow depth of field, plain warm-neutral background, eye level, looking at the camera, square 1:1 crop, friendly and professional.",
  teams: [
    {
      "key": "marketing",
      "kind": "business",
      "rank": 1,
      "label": "Marketing Team",
      "blurb": "A CMO and five specialists who plan and run your marketing",
      "purpose": "For a small business that needs marketing done properly but cannot hire a department. The CMO sets the plan and budget; the specialists create content, win search traffic, draft social posts and emails for approval, and make the visuals.",
      "project": {
        "name": "Marketing",
        "goal": "Grow qualified leads and sales with a clear ninety-day marketing plan."
      },
      "members": [
        {
          "slot": "lead",
          "role": "cmo",
          "title": "Chief Marketing Officer",
          "name": "Maya",
          "focus": [
            "Own the ninety-day plan and the weekly marketing review."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "South Asian",
            "hair": "long dark hair worn loose",
            "attire": "charcoal blazer over a cream top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "content",
          "role": "content",
          "title": "Content Writer",
          "name": "Theo",
          "focus": [
            "Write the articles and guides in the plan, one a week to start."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "White British",
            "hair": "short sandy hair, light stubble",
            "attire": "navy crew-neck sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "seo",
          "role": "seo",
          "title": "SEO Specialist",
          "name": "Amara",
          "focus": [
            "Find the searches worth winning and brief the content writer on them."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Nigerian",
            "hair": "natural curls in a high puff",
            "attire": "mustard cardigan over a white tee",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "social",
          "role": "social",
          "title": "Social Media Manager",
          "name": "Diego",
          "focus": [
            "Turn each week's content into posts for the two platforms that matter most."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "man",
            "heritage": "Mexican",
            "hair": "short black hair, neat fade",
            "attire": "olive overshirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "email",
          "role": "emailmkt",
          "title": "Email Marketer",
          "name": "Hana",
          "focus": [
            "Draft the welcome sequence and a regular campaign for the person to approve and send."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Japanese",
            "hair": "straight black bob",
            "attire": "soft grey knit top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "design",
          "role": "design",
          "title": "Designer",
          "name": "Sam",
          "focus": [
            "Make the visuals for every piece so the brand looks consistent."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "nonbinary person",
            "heritage": "Korean American",
            "hair": "short textured hair dyed dark teal",
            "attire": "black turtleneck",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "sales",
      "kind": "business",
      "rank": 2,
      "label": "Sales Team",
      "blurb": "A Head of Sales with prospecting, proposals, accounts and CRM",
      "purpose": "For a business that sells to other businesses or high-value customers. The Head of Sales keeps the pipeline honest; the team finds prospects, writes proposals, looks after existing accounts and keeps the records clean.",
      "project": {
        "name": "Sales",
        "goal": "Build a steady, honest pipeline and close more of it."
      },
      "members": [
        {
          "slot": "lead",
          "role": "salesdir",
          "title": "Head of Sales",
          "name": "Marcus",
          "focus": [
            "Run the weekly pipeline review and set each agent's priorities."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "African American",
            "hair": "close-cropped hair, trimmed beard",
            "attire": "light blue shirt, open collar",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "sdr",
          "role": "sdr",
          "title": "Sales Development Rep",
          "name": "Priya",
          "focus": [
            "Find ten new fitting prospects a week and draft first messages."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Indian",
            "hair": "long braid over one shoulder",
            "attire": "burgundy blouse",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "proposals",
          "role": "proposals",
          "title": "Proposal Writer",
          "name": "Owen",
          "focus": [
            "Turn every qualified conversation into a clear proposal within two days."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "man",
            "heritage": "Welsh",
            "hair": "grey hair, glasses",
            "attire": "tweed jacket",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "accounts",
          "role": "accounts",
          "title": "Account Manager",
          "name": "Leila",
          "focus": [
            "Keep existing customers happy and spot chances to grow them."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Lebanese",
            "hair": "wavy brown shoulder-length hair",
            "attire": "cream silk blouse",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "crm",
          "role": "crm",
          "title": "CRM Specialist",
          "name": "Kenji",
          "focus": [
            "Keep every deal and contact current, and list follow-ups due each Monday."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Japanese Brazilian",
            "hair": "short black hair, clean-shaven",
            "attire": "dark green polo",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "support",
      "kind": "business",
      "rank": 3,
      "label": "Customer Support Team",
      "blurb": "A Head of Customer Experience with support, help center, success and feedback",
      "purpose": "For any business with customers who have questions. The team drafts replies, turns repeat questions into help articles, checks in with customers at risk, and reports what customers are saying.",
      "project": {
        "name": "Customer Support",
        "goal": "Answer customers quickly and well, and fix the causes of repeat problems."
      },
      "members": [
        {
          "slot": "lead",
          "role": "cxlead",
          "title": "Head of Customer Experience",
          "name": "Grace",
          "focus": [
            "Review the week's top contact reasons and decide what to fix first."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Ghanaian British",
            "hair": "short natural hair",
            "attire": "teal cardigan",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "support",
          "role": "support",
          "title": "Support Specialist",
          "name": "Mateo",
          "focus": [
            "Draft replies to incoming questions, fastest-first for urgent ones."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "man",
            "heritage": "Colombian",
            "hair": "curly dark hair",
            "attire": "grey hoodie",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "kb",
          "role": "kb",
          "title": "Help Center Writer",
          "name": "Ingrid",
          "focus": [
            "Write an article for every question asked three times."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Norwegian",
            "hair": "blonde hair in a low bun",
            "attire": "navy knit sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "csm",
          "role": "csm",
          "title": "Customer Success Manager",
          "name": "Tariq",
          "focus": [
            "Keep the customer health list and draft check-ins for anyone at risk."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Pakistani",
            "hair": "short black hair, neat beard",
            "attire": "white shirt, dark blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "voc",
          "role": "voc",
          "title": "Customer Feedback Analyst",
          "name": "Mei",
          "focus": [
            "Summarise reviews and survey answers into themes every week."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Chinese",
            "hair": "long straight black hair",
            "attire": "lavender sweater",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "accounting",
      "kind": "business",
      "rank": 4,
      "label": "Accounting Team",
      "blurb": "A Controller with bookkeeping, bills, payroll and tax paperwork",
      "purpose": "For a small business that wants tidy books without a full-time accountant. The Controller runs the month-end close; the team records transactions, tracks bills and invoices, prepares payroll and keeps tax paperwork ready.",
      "project": {
        "name": "Accounting",
        "goal": "Close the books every month on time, with nothing missing at tax time."
      },
      "members": [
        {
          "slot": "lead",
          "role": "controller",
          "title": "Controller",
          "name": "Ruth",
          "focus": [
            "Run the month-end checklist and report what is done and waiting."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "woman",
            "heritage": "White American",
            "hair": "silver shoulder-length hair",
            "attire": "dark cardigan, pearl studs",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "books",
          "role": "books",
          "title": "Bookkeeper",
          "name": "Kwame",
          "focus": [
            "Categorise every transaction weekly and reconcile the bank."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Ghanaian",
            "hair": "short hair, round glasses",
            "attire": "light grey shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "payables",
          "role": "payables",
          "title": "Bills and Invoices Clerk",
          "name": "Sofia",
          "focus": [
            "Keep the due-date list and draft reminders for overdue invoices."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Portuguese",
            "hair": "dark hair in a ponytail",
            "attire": "white blouse",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "payroll",
          "role": "payroll",
          "title": "Payroll Coordinator",
          "name": "Anil",
          "focus": [
            "Prepare each pay run's hours and changes three days early."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Indian",
            "hair": "short greying hair",
            "attire": "navy sweater over collared shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "tax",
          "role": "taxprep",
          "title": "Tax Paperwork Organizer",
          "name": "Claire",
          "focus": [
            "Keep the tax document checklist and the deadline calendar current."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "French",
            "hair": "auburn hair in a loose bun",
            "attire": "striped Breton top",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "website",
      "kind": "business",
      "rank": 5,
      "label": "Website Team",
      "blurb": "A Website Lead with design, writing, building, search and testing",
      "purpose": "For a business that needs a new website or a better one. The lead keeps the scope clear; the team designs the pages, writes the words, builds it, makes it findable and tests it before launch.",
      "project": {
        "name": "Website",
        "goal": "Launch a clear, fast website that turns visitors into customers."
      },
      "members": [
        {
          "slot": "lead",
          "role": "webdir",
          "title": "Website Lead",
          "name": "Nadia",
          "focus": [
            "Own the site plan and the launch checklist."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Egyptian",
            "hair": "dark hair, loose waves",
            "attire": "rust-coloured blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "design",
          "role": "webdesign",
          "title": "Web Designer",
          "name": "Felix",
          "focus": [
            "Design each page mobile-first from the site plan."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "man",
            "heritage": "German",
            "hair": "messy blond hair",
            "attire": "black tee",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "copy",
          "role": "copy",
          "title": "Web Copywriter",
          "name": "Zoe",
          "focus": [
            "Write every page's words, headline first."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Australian",
            "hair": "wavy red hair",
            "attire": "denim shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "dev",
          "role": "webdev",
          "title": "Web Developer",
          "name": "Arjun",
          "focus": [
            "Build the pages on a staging copy and fix what testing finds."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Tamil",
            "hair": "short black hair, glasses",
            "attire": "dark hoodie",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "seo",
          "role": "seo",
          "title": "SEO Specialist",
          "name": "Lucia",
          "focus": [
            "Set each page's search terms, titles and descriptions."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Argentinian",
            "hair": "long brown hair",
            "attire": "soft white sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "qa",
          "role": "qa",
          "title": "Website Tester",
          "name": "Wei",
          "focus": [
            "Test every page on phone and desktop before launch and after every change."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "man",
            "heritage": "Chinese Malaysian",
            "hair": "short grey hair",
            "attire": "checked shirt",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "social",
      "kind": "business",
      "rank": 6,
      "label": "Social Media Team",
      "blurb": "A Head of Social with posts, video, design, community and partnerships",
      "purpose": "For a business whose customers live on social media. The Head of Social sets the plan; the team drafts posts, scripts short videos, makes graphics, looks after comments and messages, and finds collaborators.",
      "project": {
        "name": "Social Media",
        "goal": "Build a steady, engaged following that turns into customers."
      },
      "members": [
        {
          "slot": "lead",
          "role": "sociallead",
          "title": "Head of Social",
          "name": "Jade",
          "focus": [
            "Own the two-week plan and approve every post before it reaches the person."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Vietnamese Australian",
            "hair": "sleek black hair, side part",
            "attire": "cropped white blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "posts",
          "role": "social",
          "title": "Social Media Manager",
          "name": "Luca",
          "focus": [
            "Draft the planned posts for each platform and line them up for the person to approve."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "man",
            "heritage": "Italian",
            "hair": "dark curly hair",
            "attire": "linen shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "video",
          "role": "video",
          "title": "Short Video Producer",
          "name": "Imani",
          "focus": [
            "Script two short videos a week with hooks and captions."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Kenyan",
            "hair": "long box braids",
            "attire": "bright yellow top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "design",
          "role": "design",
          "title": "Social Designer",
          "name": "Oscar",
          "focus": [
            "Make graphics and thumbnails in the brand style."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Swedish",
            "hair": "short blond hair, beard",
            "attire": "grey knit",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "community",
          "role": "community",
          "title": "Community Manager",
          "name": "Rosa",
          "focus": [
            "Sort comments and messages daily and draft replies."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Puerto Rican",
            "hair": "curly dark hair",
            "attire": "coral blouse",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "partners",
          "role": "partnerships",
          "title": "Creator Partnerships",
          "name": "Aiden",
          "focus": [
            "Find creators and brands that fit, and draft outreach."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Irish",
            "hair": "short red hair, freckles",
            "attire": "navy bomber jacket",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "exec",
      "kind": "business",
      "rank": 7,
      "label": "Executive Assistant Team",
      "blurb": "A Chief of Staff with inbox, calendar, meetings, travel and research",
      "purpose": "For a founder, owner or busy professional. The Chief of Staff plans your week around your priorities; the team sorts your inbox, prepares meetings, plans travel and researches what you need to know.",
      "project": {
        "name": "My Office",
        "goal": "Give the person back ten hours a week and keep them focused on their top priorities."
      },
      "members": [
        {
          "slot": "lead",
          "role": "cos",
          "title": "Chief of Staff",
          "name": "Eleanor",
          "focus": [
            "Give the person a Monday plan and a Friday wrap-up every week."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "woman",
            "heritage": "Black British",
            "hair": "short grey natural hair",
            "attire": "tailored navy blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "ea",
          "role": "ea",
          "title": "Executive Assistant",
          "name": "Daniel",
          "focus": [
            "Prepare each day: what is on, what needs prep, what can move."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Filipino",
            "hair": "short black hair",
            "attire": "white oxford shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "inbox",
          "role": "email",
          "title": "Inbox Manager",
          "name": "Freya",
          "focus": [
            "Sort the inbox twice a day and draft replies for approval."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Scottish",
            "hair": "long strawberry-blonde hair",
            "attire": "cream jumper",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "meetings",
          "role": "meet",
          "title": "Meeting Assistant",
          "name": "Hiro",
          "focus": [
            "Prepare agendas, and draft notes and actions after every meeting for the person to send."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Japanese",
            "hair": "neat side-parted hair",
            "attire": "charcoal sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "travel",
          "role": "travel",
          "title": "Travel Planner",
          "name": "Valentina",
          "focus": [
            "Plan every trip with options and a one-page itinerary."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Chilean",
            "hair": "long dark wavy hair",
            "attire": "camel coat",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "research",
          "role": "researcher",
          "title": "Research Associate",
          "name": "Yusuf",
          "focus": [
            "Write a one-page brief for anything the person needs to know before a decision."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "man",
            "heritage": "Turkish",
            "hair": "dark hair, short beard",
            "attire": "olive sweater",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "operations",
      "kind": "business",
      "rank": 8,
      "label": "Operations Team",
      "blurb": "A COO with processes, suppliers, stock, scheduling and reporting",
      "purpose": "For a business with day-to-day moving parts: stock, suppliers, staff schedules and recurring work. The COO keeps it running; the team documents processes, manages suppliers, plans stock, runs the meeting rhythm and reports the numbers.",
      "project": {
        "name": "Operations",
        "goal": "Make the day-to-day run smoothly and measurably better each month."
      },
      "members": [
        {
          "slot": "lead",
          "role": "coo",
          "title": "Chief Operating Officer",
          "name": "Victor",
          "focus": [
            "Keep the ranked list of what is slowing the business down."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "man",
            "heritage": "Nigerian British",
            "hair": "shaved head, grey beard",
            "attire": "dark suit, no tie",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "ops",
          "role": "ops",
          "title": "Operations Manager",
          "name": "Elena",
          "focus": [
            "Run the recurring checklists and handoffs each week."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Russian",
            "hair": "blonde hair pulled back",
            "attire": "white shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "process",
          "role": "process",
          "title": "Process Designer",
          "name": "Rahul",
          "focus": [
            "Write down one process a week so anyone can follow it."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Indian",
            "hair": "short hair, glasses",
            "attire": "blue sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "vendors",
          "role": "vendors",
          "title": "Supplier Manager",
          "name": "Chloe",
          "focus": [
            "Keep supplier contracts, prices and renewal dates in one list."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Canadian",
            "hair": "chestnut bob",
            "attire": "green cardigan",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "stock",
          "role": "inventory",
          "title": "Inventory Planner",
          "name": "Tomasz",
          "focus": [
            "List what to reorder every Monday."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Polish",
            "hair": "short brown hair",
            "attire": "grey work shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "data",
          "role": "data",
          "title": "Operations Analyst",
          "name": "Aisha",
          "focus": [
            "Report the five numbers that show whether operations are healthy, weekly."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Somali",
            "hair": "patterned headscarf",
            "attire": "navy top",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "hr",
      "kind": "business",
      "rank": 9,
      "label": "HR and People Team",
      "blurb": "A Head of People with recruiting, onboarding, policies and training",
      "purpose": "For a growing team that needs people matters handled well. The Head of People sets priorities; the team coordinates hiring, welcomes new starters, drafts policies and builds training.",
      "project": {
        "name": "People",
        "goal": "Hire well, welcome people properly, and keep the team growing."
      },
      "members": [
        {
          "slot": "lead",
          "role": "hrlead",
          "title": "Head of People",
          "name": "Naomi",
          "focus": [
            "Keep the people priorities list and review every draft before it reaches the person."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Ethiopian",
            "hair": "natural hair in a low bun",
            "attire": "soft blue blouse",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "recruiting",
          "role": "recruiting",
          "title": "Recruiting Coordinator",
          "name": "Jamal",
          "focus": [
            "Write job posts, screen applications, and propose interview times for the person to confirm."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Moroccan",
            "hair": "short dark hair, beard",
            "attire": "grey blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "onboarding",
          "role": "onboarding",
          "title": "Onboarding Coordinator",
          "name": "Lily",
          "focus": [
            "Prepare the first two weeks for every new starter."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Taiwanese",
            "hair": "long hair with bangs",
            "attire": "white knit",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "policy",
          "role": "policy",
          "title": "HR Policy Writer",
          "name": "George",
          "focus": [
            "Draft the handbook and policies, flagged for a lawyer's check."
          ],
          "avatar": {
            "apparentAge": "60s",
            "presentation": "man",
            "heritage": "White American",
            "hair": "white hair, glasses",
            "attire": "navy cardigan",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "training",
          "role": "training",
          "title": "Training Coordinator",
          "name": "Carmen",
          "focus": [
            "Build a short training plan for each role."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Spanish",
            "hair": "dark wavy hair",
            "attire": "red sweater",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "ecommerce",
      "kind": "business",
      "rank": 10,
      "label": "E-commerce Team",
      "blurb": "An E-commerce Manager with listings, orders, stock, ads and support",
      "purpose": "For an online store. The E-commerce Manager watches sales and the store; the team writes listings, tracks orders and returns, plans stock, plans ads and drafts customer replies.",
      "project": {
        "name": "Online Store",
        "goal": "Grow online sales while keeping customers happy and stock right."
      },
      "members": [
        {
          "slot": "lead",
          "role": "ecom",
          "title": "E-commerce Manager",
          "name": "Isabella",
          "focus": [
            "Review sales, stock and reviews every week and set priorities."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Brazilian",
            "hair": "long dark hair, loose waves",
            "attire": "black blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "listings",
          "role": "listings",
          "title": "Product Listing Writer",
          "name": "Noah",
          "focus": [
            "Write or improve five listings a week."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "man",
            "heritage": "Dutch",
            "hair": "blond hair, short",
            "attire": "grey tee",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "orders",
          "role": "orders",
          "title": "Orders and Returns Specialist",
          "name": "Fatima",
          "focus": [
            "Keep the late and returned orders list and draft customer updates."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Bangladeshi",
            "hair": "hijab in soft pink",
            "attire": "cream top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "stock",
          "role": "inventory",
          "title": "Inventory Planner",
          "name": "Chen",
          "focus": [
            "Say what to reorder before anything sells out."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Chinese",
            "hair": "short black hair, glasses",
            "attire": "navy polo",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "ads",
          "role": "ppc",
          "title": "Paid Ads Specialist",
          "name": "Ava",
          "focus": [
            "Plan small ad tests and report cost per sale."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Irish American",
            "hair": "long light brown hair",
            "attire": "olive jacket",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "support",
          "role": "support",
          "title": "Customer Support",
          "name": "Kofi",
          "focus": [
            "Draft replies to customer questions every day."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Ghanaian",
            "hair": "short twists",
            "attire": "orange sweater",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "content",
      "kind": "business",
      "rank": 11,
      "label": "Content Team",
      "blurb": "An Editor in Chief with writing, video, podcast and newsletter",
      "purpose": "For a business or creator that publishes to build an audience. The Editor sets the calendar and the voice; the team writes articles, scripts video, produces the podcast and writes the newsletter.",
      "project": {
        "name": "Content",
        "goal": "Build a loyal audience with consistently good content, published with the person's go-ahead."
      },
      "members": [
        {
          "slot": "lead",
          "role": "editor",
          "title": "Editor in Chief",
          "name": "Simone",
          "focus": [
            "Own the monthly content calendar and edit everything before it reaches the person."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "woman",
            "heritage": "Haitian",
            "hair": "short curly grey hair",
            "attire": "black turtleneck, statement earrings",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "writer",
          "role": "content",
          "title": "Content Writer",
          "name": "Ethan",
          "focus": [
            "Write the articles in the calendar."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Korean",
            "hair": "short black hair",
            "attire": "denim jacket",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "video",
          "role": "video",
          "title": "Video Producer",
          "name": "Zara",
          "focus": [
            "Script and plan every video in the calendar."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Pakistani British",
            "hair": "long dark hair",
            "attire": "mustard top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "podcast",
          "role": "podcast",
          "title": "Podcast Producer",
          "name": "Malik",
          "focus": [
            "Prepare each guest brief and write show notes."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Jamaican",
            "hair": "locs tied back",
            "attire": "charcoal hoodie",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "newsletter",
          "role": "newsletter",
          "title": "Newsletter Writer",
          "name": "Astrid",
          "focus": [
            "Draft each issue from the week's best content."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Danish",
            "hair": "short platinum hair",
            "attire": "cream cable-knit",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "finance",
      "kind": "business",
      "rank": 12,
      "label": "Finance Team",
      "blurb": "A CFO with analysis, pricing, cash and investor updates",
      "purpose": "For a business that has its bookkeeping in place and needs to plan ahead: budgets, forecasts, pricing and fundraising. The CFO owns cash and the forecast; the team models, prices, keeps the books and prepares investor material.",
      "project": {
        "name": "Finance",
        "goal": "Know where the money is going, what is coming, and what to do about it."
      },
      "members": [
        {
          "slot": "lead",
          "role": "cfo",
          "title": "Chief Financial Officer",
          "name": "Jonathan",
          "focus": [
            "Keep the thirteen-week cash forecast and the monthly finance review."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "man",
            "heritage": "White American",
            "hair": "short grey hair",
            "attire": "navy suit, white shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "analyst",
          "role": "finance",
          "title": "Financial Analyst",
          "name": "Mina",
          "focus": [
            "Build the budget and compare actuals every month."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Iranian",
            "hair": "dark hair, loose",
            "attire": "plum blouse",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "pricing",
          "role": "pricing",
          "title": "Pricing Analyst",
          "name": "Samuel",
          "focus": [
            "Check margins by product and suggest price tests."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Nigerian",
            "hair": "short hair, glasses",
            "attire": "light blue shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "books",
          "role": "books",
          "title": "Bookkeeper",
          "name": "Elif",
          "focus": [
            "Keep the books current so the numbers can be trusted."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Turkish",
            "hair": "brown hair in a braid",
            "attire": "grey cardigan",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "investor",
          "role": "investor",
          "title": "Investor Relations",
          "name": "Ravi",
          "focus": [
            "Draft the monthly investor update and keep the fundraising list."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Gujarati",
            "hair": "short black hair",
            "attire": "dark blazer",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "frontdesk",
      "kind": "business",
      "rank": 13,
      "label": "Front Office Team",
      "blurb": "An Office Manager with bookings, reviews, support and bookkeeping",
      "purpose": "For a local service business: a salon, clinic, studio, trade or shop. The Office Manager runs the front desk; the team keeps the diary, looks after reviews, drafts customer replies and keeps the books.",
      "project": {
        "name": "Front Office",
        "goal": "Keep the diary full, customers happy and the paperwork done."
      },
      "members": [
        {
          "slot": "lead",
          "role": "officemgr",
          "title": "Office Manager",
          "name": "Patricia",
          "focus": [
            "Keep the daily list: bookings, messages and anything running low."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "woman",
            "heritage": "Filipino American",
            "hair": "short dark bob",
            "attire": "lilac cardigan",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "booking",
          "role": "booking",
          "title": "Booking Coordinator",
          "name": "Andre",
          "focus": [
            "Keep the diary clear and draft reminders and reschedules."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "man",
            "heritage": "Afro-Brazilian",
            "hair": "short curly hair",
            "attire": "white polo",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "reviews",
          "role": "reviews",
          "title": "Reviews and Reputation",
          "name": "Olivia",
          "focus": [
            "Draft replies to every new review."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "English",
            "hair": "light brown hair in a ponytail",
            "attire": "sage green top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "support",
          "role": "support",
          "title": "Customer Messages",
          "name": "Hamza",
          "focus": [
            "Draft replies to calls and messages that need an answer."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Algerian",
            "hair": "short dark hair, stubble",
            "attire": "grey sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "books",
          "role": "books",
          "title": "Bookkeeper",
          "name": "Wendy",
          "focus": [
            "Record takings and costs weekly."
          ],
          "avatar": {
            "apparentAge": "60s",
            "presentation": "woman",
            "heritage": "Chinese Canadian",
            "hair": "short grey hair",
            "attire": "navy cardigan",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "software",
      "kind": "business",
      "rank": 14,
      "label": "Software Team",
      "blurb": "A Product Director with product, engineering, testing, security and design",
      "purpose": "For a business building an app or software product. The Product Director owns the roadmap; the team writes specs, builds, tests, reviews security and designs the screens.",
      "project": {
        "name": "Product",
        "goal": "Ship the most valuable improvements every two weeks, tested and safe."
      },
      "members": [
        {
          "slot": "lead",
          "role": "productdir",
          "title": "Product Director",
          "name": "Alicia",
          "focus": [
            "Own the roadmap and the two-week plan."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Mexican American",
            "hair": "dark hair, shoulder length",
            "attire": "black blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "pm",
          "role": "product",
          "title": "Product Manager",
          "name": "Ibrahim",
          "focus": [
            "Write a clear spec for each item in the plan."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Sudanese",
            "hair": "short hair",
            "attire": "blue shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "engineer",
          "role": "engineer",
          "title": "Software Engineer",
          "name": "Kai",
          "focus": [
            "Build the specs in small, reviewed changes."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "nonbinary person",
            "heritage": "Native Hawaiian",
            "hair": "long dark hair tied back",
            "attire": "grey hoodie",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "qa",
          "role": "qa",
          "title": "QA Tester",
          "name": "Nina",
          "focus": [
            "Test every change before it ships."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Ukrainian",
            "hair": "blonde hair in a bun",
            "attire": "white tee",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "security",
          "role": "security",
          "title": "Security Reviewer",
          "name": "Rafael",
          "focus": [
            "Review every change that touches sign-in, payments or personal data."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Filipino",
            "hair": "short hair, glasses",
            "attire": "dark polo",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "design",
          "role": "design",
          "title": "Product Designer",
          "name": "Yara",
          "focus": [
            "Design the screens for each spec."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Palestinian",
            "hair": "long curly hair",
            "attire": "olive shirt",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "fundraising",
      "kind": "business",
      "rank": 15,
      "label": "Fundraising Team",
      "blurb": "A Development Director with grants, donors, events and newsletter",
      "purpose": "For a nonprofit, school or community group. The Development Director sets the fundraising plan; the team finds and writes grants, thanks and updates donors, plans events and writes the supporter newsletter.",
      "project": {
        "name": "Fundraising",
        "goal": "Raise enough, from enough sources, to fund the mission reliably."
      },
      "members": [
        {
          "slot": "lead",
          "role": "devdir",
          "title": "Development Director",
          "name": "Beatrice",
          "focus": [
            "Keep the fundraising plan and the deadline calendar."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "woman",
            "heritage": "Kenyan",
            "hair": "short natural grey hair",
            "attire": "emerald blouse",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "grants",
          "role": "grants",
          "title": "Grant Writer",
          "name": "Julian",
          "focus": [
            "Find fitting grants and draft applications."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "White Canadian",
            "hair": "brown hair, beard",
            "attire": "tweed jacket",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "donors",
          "role": "donors",
          "title": "Donor Relations",
          "name": "Mariam",
          "focus": [
            "Draft thank-yous within a day and keep donors updated."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Egyptian",
            "hair": "hijab in navy",
            "attire": "cream top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "events",
          "role": "events",
          "title": "Events Coordinator",
          "name": "Tyler",
          "focus": [
            "Plan the fundraising events from budget to run sheet."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "man",
            "heritage": "African American",
            "hair": "short fade",
            "attire": "burgundy sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "newsletter",
          "role": "newsletter",
          "title": "Supporter Newsletter",
          "name": "Keiko",
          "focus": [
            "Write the supporter newsletter with real stories."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Japanese American",
            "hair": "shoulder-length black hair",
            "attire": "soft grey cardigan",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "home",
      "kind": "personal",
      "rank": 1,
      "label": "Home Team",
      "blurb": "A Household Manager with maintenance, meals, money and errands",
      "purpose": "For running a home without it running you. The Household Manager keeps the list; the team plans maintenance, plans meals and shopping, keeps the budget, and researches purchases and keeps the errands list.",
      "project": {
        "name": "Home",
        "goal": "Keep the home running smoothly and take the mental load off the person."
      },
      "members": [
        {
          "slot": "lead",
          "role": "household",
          "title": "Household Manager",
          "name": "Martha",
          "focus": [
            "Keep one household list and a Sunday plan for the week."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "woman",
            "heritage": "Irish",
            "hair": "short auburn hair",
            "attire": "soft blue sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "maintenance",
          "role": "maintenance",
          "title": "Home Maintenance Planner",
          "name": "Joe",
          "focus": [
            "Keep the seasonal maintenance calendar and repairs list."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "man",
            "heritage": "Italian American",
            "hair": "grey hair, moustache",
            "attire": "flannel shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "meals",
          "role": "meals",
          "title": "Meal Planner",
          "name": "Aiko",
          "focus": [
            "Plan the week's meals and the shopping list every Saturday."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Japanese",
            "hair": "short black hair",
            "attire": "striped apron over a white tee",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "budget",
          "role": "budget",
          "title": "Budget Coach",
          "name": "Desmond",
          "focus": [
            "Track spending against the household budget monthly."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Jamaican British",
            "hair": "short hair, trimmed beard",
            "attire": "navy sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "errands",
          "role": "shopper",
          "title": "Shopping and Errands",
          "name": "Lina",
          "focus": [
            "Research purchases and keep the errands list."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Lebanese",
            "hair": "long dark hair",
            "attire": "denim jacket",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "life",
      "kind": "personal",
      "rank": 2,
      "label": "Personal Life Team",
      "blurb": "A Personal Assistant with health, money, travel and occasions",
      "purpose": "For keeping your own life organised: appointments, health, money, trips and the people who matter. The Personal Assistant runs your week; the team looks after health admin, money, travel and birthdays.",
      "project": {
        "name": "My Life",
        "goal": "Keep life organised so nothing important slips, and make time for what matters."
      },
      "members": [
        {
          "slot": "lead",
          "role": "personal",
          "title": "Personal Assistant",
          "name": "Clara",
          "focus": [
            "Give the person a short Monday plan: what is on, what is due, what to decide."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "German",
            "hair": "blonde bob",
            "attire": "cream blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "health",
          "role": "healthadmin",
          "title": "Health Admin Assistant",
          "name": "Sipho",
          "focus": [
            "Keep appointments, refills and claims on one list."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "South African",
            "hair": "short hair",
            "attire": "light blue shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "money",
          "role": "pcfo",
          "title": "Personal Finance Manager",
          "name": "Helen",
          "focus": [
            "Keep the monthly budget and bills calendar."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "woman",
            "heritage": "Greek",
            "hair": "dark hair with grey streaks",
            "attire": "navy cardigan",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "travel",
          "role": "travel",
          "title": "Travel Planner",
          "name": "Arturo",
          "focus": [
            "Plan trips with options and an itinerary."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Peruvian",
            "hair": "black hair, short",
            "attire": "linen shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "occasions",
          "role": "occasions",
          "title": "Occasions and Gifts",
          "name": "Poppy",
          "focus": [
            "Remind two weeks before every birthday and suggest gifts."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "English",
            "hair": "curly blonde hair",
            "attire": "pink sweater",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "family",
      "kind": "personal",
      "rank": 3,
      "label": "Family Team",
      "blurb": "A Family Coordinator with school, meals, tutoring and occasions",
      "purpose": "For a busy family. The Family Coordinator keeps the shared calendar; the team tracks school messages and forms, plans meals, helps the children learn, and remembers the occasions.",
      "project": {
        "name": "Family",
        "goal": "Keep the family calendar calm and nobody's plans forgotten."
      },
      "members": [
        {
          "slot": "lead",
          "role": "family",
          "title": "Family Coordinator",
          "name": "Paloma",
          "focus": [
            "Keep the family calendar and a Sunday week-ahead summary."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Mexican",
            "hair": "dark hair in a ponytail",
            "attire": "coral top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "school",
          "role": "school",
          "title": "School Liaison",
          "name": "Omar",
          "focus": [
            "Pull every school date and form into the weekly list."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Syrian",
            "hair": "short dark hair, beard",
            "attire": "grey sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "meals",
          "role": "meals",
          "title": "Meal Planner",
          "name": "Signe",
          "focus": [
            "Plan quick family meals around the busy nights."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Swedish",
            "hair": "blonde braid",
            "attire": "white knit",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "tutor",
          "role": "tutor",
          "title": "Homework Tutor",
          "name": "Tunde",
          "focus": [
            "Help each child understand homework without doing it for them."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "man",
            "heritage": "Nigerian",
            "hair": "short grey hair, glasses",
            "attire": "checked shirt, cardigan",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "occasions",
          "role": "occasions",
          "title": "Occasions Planner",
          "name": "June",
          "focus": [
            "Plan birthdays, parties and gifts ahead of time."
          ],
          "avatar": {
            "apparentAge": "60s",
            "presentation": "woman",
            "heritage": "Korean",
            "hair": "short grey hair",
            "attire": "lavender cardigan",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "health",
      "kind": "personal",
      "rank": 4,
      "label": "Health and Wellness Team",
      "blurb": "A Wellness Coach with fitness, nutrition, sleep and health admin",
      "purpose": "For building healthier habits that stick. The Wellness Coach agrees the goals; the team plans workouts, meals, sleep and habits, and keeps health paperwork organised. It is not medical advice.",
      "project": {
        "name": "Health",
        "goal": "Build a few healthy habits that last, one step at a time."
      },
      "members": [
        {
          "slot": "lead",
          "role": "wellness",
          "title": "Wellness Coach",
          "name": "Leilani",
          "focus": [
            "Agree one or two goals and check in every week."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Samoan",
            "hair": "long wavy dark hair",
            "attire": "sage athletic zip top",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "fitness",
          "role": "fitness",
          "title": "Fitness Coach",
          "name": "Marco",
          "focus": [
            "Plan the week's workouts to fit the time available."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Brazilian",
            "hair": "short dark hair",
            "attire": "grey training tee",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "nutrition",
          "role": "nutrition",
          "title": "Nutrition Planner",
          "name": "Anjali",
          "focus": [
            "Plan balanced meals and a shopping list."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Indian",
            "hair": "dark hair in a bun",
            "attire": "white shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "sleep",
          "role": "habits",
          "title": "Habits and Sleep Coach",
          "name": "Walter",
          "focus": [
            "Help build one small habit at a time and better sleep."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "man",
            "heritage": "White American",
            "hair": "salt-and-pepper hair",
            "attire": "navy henley",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "admin",
          "role": "healthadmin",
          "title": "Health Admin Assistant",
          "name": "Mercy",
          "focus": [
            "Keep appointments and refills on track."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Ghanaian",
            "hair": "short natural hair",
            "attire": "teal cardigan",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "money",
      "kind": "personal",
      "rank": 5,
      "label": "Money Team",
      "blurb": "A Personal Finance Manager with budget, bills, tax paperwork and research",
      "purpose": "For getting your personal money organised. The Personal Finance Manager keeps the big picture; the team runs the budget, finds savings on bills, organises tax paperwork and explains investment options. It is not financial advice.",
      "project": {
        "name": "Money",
        "goal": "Spend on purpose, save steadily, and never miss a deadline."
      },
      "members": [
        {
          "slot": "lead",
          "role": "pcfo",
          "title": "Personal Finance Manager",
          "name": "Harold",
          "focus": [
            "Keep the monthly money review and the bills calendar."
          ],
          "avatar": {
            "apparentAge": "60s",
            "presentation": "man",
            "heritage": "Black American",
            "hair": "short grey hair, glasses",
            "attire": "navy cardigan",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "budget",
          "role": "budget",
          "title": "Budget Coach",
          "name": "Mia",
          "focus": [
            "Sort spending monthly and suggest one change."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "Filipino",
            "hair": "long black hair",
            "attire": "white sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "bills",
          "role": "subscriptions",
          "title": "Subscriptions and Bills Auditor",
          "name": "Liam",
          "focus": [
            "List every recurring charge and mark savings."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Irish",
            "hair": "short brown hair",
            "attire": "grey quarter-zip",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "tax",
          "role": "taxprep",
          "title": "Tax Paperwork Organizer",
          "name": "Yuna",
          "focus": [
            "Keep the tax documents and deadlines ready."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "woman",
            "heritage": "Korean American",
            "hair": "shoulder-length black hair",
            "attire": "cream blouse",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "invest",
          "role": "investing",
          "title": "Investment Researcher",
          "name": "Vikram",
          "focus": [
            "Explain options in plain language when asked."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Punjabi",
            "hair": "short hair, beard, turban in navy",
            "attire": "white shirt",
            "expression": "warm, confident smile"
          }
        }
      ]
    },
    {
      "key": "career",
      "kind": "personal",
      "rank": 6,
      "label": "Career Team",
      "blurb": "A Career Coach with CV, job search, interview prep and profile",
      "purpose": "For finding your next role. The Career Coach sets the target and weekly plan; the team tailors your CV, finds openings, prepares you for interviews and sharpens your professional profile.",
      "project": {
        "name": "Career",
        "goal": "Land the right next role, with a steady weekly plan to get there."
      },
      "members": [
        {
          "slot": "lead",
          "role": "career",
          "title": "Career Coach",
          "name": "Denise",
          "focus": [
            "Agree the target role and a weekly plan, and review progress each Friday."
          ],
          "avatar": {
            "apparentAge": "50s",
            "presentation": "woman",
            "heritage": "African American",
            "hair": "short curly hair",
            "attire": "mustard blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "cv",
          "role": "resume",
          "title": "Resume Writer",
          "name": "Pablo",
          "focus": [
            "Tailor the CV and cover letter for each application."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "man",
            "heritage": "Spanish",
            "hair": "dark hair, short beard",
            "attire": "white shirt",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "scout",
          "role": "jobscout",
          "title": "Job Scout",
          "name": "Hannah",
          "focus": [
            "Find ten fitting openings a week and keep the tracker."
          ],
          "avatar": {
            "apparentAge": "20s",
            "presentation": "woman",
            "heritage": "White American",
            "hair": "long curly brown hair",
            "attire": "green sweater",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "interview",
          "role": "interview",
          "title": "Interview Coach",
          "name": "Kenneth",
          "focus": [
            "Prepare for each interview with practice questions."
          ],
          "avatar": {
            "apparentAge": "40s",
            "presentation": "man",
            "heritage": "Chinese Singaporean",
            "hair": "short black hair, glasses",
            "attire": "navy blazer",
            "expression": "warm, confident smile"
          }
        },
        {
          "slot": "brand",
          "role": "brand",
          "title": "Personal Brand Coach",
          "name": "Aaliyah",
          "focus": [
            "Improve the profile and draft one post a week."
          ],
          "avatar": {
            "apparentAge": "30s",
            "presentation": "woman",
            "heritage": "Afro-Caribbean",
            "hair": "long braids",
            "attire": "cream turtleneck",
            "expression": "warm, confident smile"
          }
        }
      ]
    }
  ],
};
