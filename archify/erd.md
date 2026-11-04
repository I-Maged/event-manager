# Event Manager database ERD

Source: `prisma/schema.prisma`

Identity is managed by Neon Auth in the separate `neon_auth` schema. Fields
such as `userId`, `organizerName`, `attendeeName`, `checkedInBy`, and `authorName`
are application-level references and denormalized display values, not PostgreSQL
foreign keys. Physical indexes are listed as comments for fields/tables below.

```mermaid
erDiagram
    %% Managed Auth owns identity in neon_auth. userId and auth-derived fields
    %% are app-level references only. WHERE TO SAVE: this file.

    EVENT {
        string id PK "cuid(); default"
        string title
        string description
        datetime date
        string timeZone "nullable; IANA zone"
        string location
        int maxAttendees "nullable; CHECK > 0 OR NULL"
        boolean isPublic "default true"
        EventCategory category "default OTHER"
        datetime createdAt "default now"
        datetime updatedAt "updatedAt"
        string userId "Managed Auth user id; app-level only"
        string organizerName "nullable; denormalized display name"
        string inviteToken UK "nullable; unique; private invite token"
    }

    RSVP {
        string id PK "cuid(); default"
        RSVPStatus status
        datetime createdAt "default now"
        datetime updatedAt "updatedAt"
        datetime promotedAt "nullable; set when promoted from waitlist"
        string attendeeName "nullable; denormalized display name"
        datetime checkedInAt "nullable; check-in timestamp"
        string checkedInBy "nullable; organizer who checked in; app-level only"
        boolean notifyOnUpdate "default true"
        string userId "Managed Auth user id; app-level only"
        string eventId FK "NOT NULL; Event.id"
    }

    COMMENT {
        string id PK "cuid(); default"
        string eventId FK "NOT NULL; Event.id"
        string userId "Managed Auth user id; app-level only"
        string authorName "nullable; denormalized display name"
        string body "CHECK char_length(body) <= 1000"
        datetime createdAt "default now"
    }

    NOTIFICATION {
        string id PK "cuid(); default"
        string userId "Managed Auth user id; app-level only"
        string eventId FK "nullable; Event.id"
        NotificationType type
        string title
        string body "nullable"
        datetime readAt "nullable"
        datetime createdAt "default now"
    }

    RATE_LIMIT {
        string key PK "format: scope:userId"
        int count "default 0"
        timestamptz windowStart "default now; Timestamptz(3)"
    }

    EVENT ||--o{ RSVP : "RSVP.eventId -> Event.id; onDelete Cascade"
    EVENT ||--o{ COMMENT : "Comment.eventId -> Event.id; onDelete Cascade"
    EVENT |o--o{ NOTIFICATION : "Notification.eventId -> Event.id; nullable; onDelete Cascade"

    EVENT {
        %% @@index([userId, date])
        %% @@index([isPublic, date])
        %% @@index([category, date])
    }
    RSVP {
        %% @@unique([userId, eventId])
        %% @@index([userId])
        %% @@index([eventId])
        %% @@index([eventId, status, createdAt])
    }
    COMMENT {
        %% @@index([eventId, createdAt])
    }
    NOTIFICATION {
        %% @@index([userId, createdAt])
        %% @@index([userId, readAt])
    }
    RATE_LIMIT {
        %% @@index([windowStart])
    }
```

## Relationship notes

- `EVENT ||--o{ RSVP`: one Event may have zero or more RSVPs; every RSVP belongs to
  exactly one Event.
- `EVENT ||--o{ COMMENT`: one Event may have zero or more Comments; every Comment
  belongs to exactly one Event.
- `EVENT |o--o{ NOTIFICATION`: one Event may have zero or more Notifications; a
  Notification may belong to zero or one Event because `eventId` is nullable.

## Constraints summarized outside the table headers

- `Event.inviteToken` is unique when present.
- `RSVP(userId, eventId)` is unique.
- `RateLimit.key` is the primary key.
- `Event.maxAttendees` is either NULL or greater than 0 at the database level.
- `Comment.body` is limited to 1000 characters at the database level.
- Neon Auth user identifiers are not enforced by database foreign keys.
