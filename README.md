# Life Command

A simple personal operations dashboard.

## Features

- Calendar events
- Homework tracker
- Todo list
- Shopping list
- GitHub/project links
- Rolling log
- Weather
- Space dashboard
- Supabase cloud sync

## Storage

Life Command now saves the main dashboard state to Supabase using the `life_entries` table.

Synced through Supabase:

- Calendar
- Homework
- Todos
- Shopping
- Projects
- Rolling log

Kept in localStorage as device settings:

- Theme
- Google Calendar API settings
- ISS pass API URL

## Supabase requirements

The `life_entries` table needs a `data` column:

- name: `data`
- type: `jsonb`
- default: `{}`

RLS policies needed:

- SELECT
- INSERT
- UPDATE
- DELETE

For personal testing, each policy can use `true`.
