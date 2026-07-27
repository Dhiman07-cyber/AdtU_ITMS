Document Structure (Final)

This will become approximately 300–500 pages when complete.

ITMS_Production_Architecture_Specification_v1.0.md

PART I — FOUNDATION

Chapter 1. Vision & Objectives
Chapter 2. Functional Requirements
Chapter 3. Non-Functional Requirements
Chapter 4. Stakeholders & User Roles
Chapter 5. Complete System Overview

PART II — CORE ARCHITECTURE

Chapter 6. Overall System Architecture
Chapter 7. Database Architecture
Chapter 8. Authentication & Authorization
Chapter 9. Driver Assignment Architecture
Chapter 10. Driver Runtime Lifecycle
Chapter 11. Student Runtime Lifecycle
Chapter 12. Admin Runtime
Chapter 13. Moderator Runtime

PART III — TRIP SYSTEM

Chapter 14. QR Runtime Architecture
Chapter 15. Trip Lifecycle
Chapter 16. Driver State Machine
Chapter 17. Student State Machine
Chapter 18. Bus Runtime State
Chapter 19. Shift Management

PART IV — REALTIME

Chapter 20. WebSocket Architecture
Chapter 21. Location Streaming Pipeline
Chapter 22. Student Subscription Architecture
Chapter 23. Presence System
Chapter 24. Connection Recovery

PART V — NOTIFICATIONS

Chapter 25. FCM Architecture
Chapter 26. Notification Flow
Chapter 27. Background Behaviour
Chapter 28. Foreground Behaviour

PART VI — SECURITY

Chapter 29. Authentication Security
Chapter 30. Authorization
Chapter 31. Threat Model
Chapter 32. Attack Vectors
Chapter 33. Data Protection
Chapter 34. Privacy
Chapter 35. Audit System

PART VII — FAILURE HANDLING

Chapter 36. Network Failures
Chapter 37. Offline Behaviour
Chapter 38. Error Recovery
Chapter 39. Disaster Recovery
Chapter 40. Backup Strategy

PART VIII — PERFORMANCE

Chapter 41. Performance Targets
Chapter 42. Scaling Strategy
Chapter 43. AWS Deployment
Chapter 44. NGINX
Chapter 45. Monitoring
Chapter 46. Logging
Chapter 47. Cost Optimization

PART IX — QUALITY

Chapter 48. Testing Strategy
Chapter 49. Production Checklist
Chapter 50. Future Extensions
How every chapter will be written

Every chapter follows the exact same template.

Purpose

Scope

Objectives

Architecture

Execution Flow

State Machine

Sequence Diagram

Database Changes

API Contracts

WebSocket Behaviour

FCM Behaviour

Security

Failure Handling

Edge Cases

Race Conditions

Performance

Testing

Future Improvements

This ensures the entire document is consistent.

Writing Rules

This specification is not an implementation guide.

It must answer:

WHY something exists.
HOW it works.
WHEN it executes.
WHO is responsible.
WHAT can go wrong.
HOW recovery happens.
WHY alternatives were rejected.

Nothing should remain ambiguous.

Documentation Standards

Every runtime flow should include:

Sequence Diagram
Runtime Flow
State Machine
Component Responsibilities
Security Review
Failure Recovery
Edge Cases
Performance Considerations
Every major feature must answer

For example QR Runtime.

Not

Driver scans QR.

Instead

Why QR?

What information is encoded?

Why not encode Driver ID?

Why not encode JWT?

Static or Dynamic QR?

Who generates QR?

Who owns QR?

Who replaces damaged QR?

Can Google Lens scan?

Can Camera app scan?

Should App Links be supported?

What if app isn't installed?

What if QR photographed?

What if QR copied?

Replay attack?

Clock drift?

Offline?

Multiple scans?

Driver changed?

Bus changed?

Assignment changed?

Trip already active?

GPS disabled?

Network lost?

JWT expired?

Firebase unavailable?

Supabase unavailable?

Audit log?

Testing?

Future extension?

That level of detail.

Same for WebSocket

Instead of

Driver connects.

We'll answer

Who starts server?

When?

Authentication?

JWT refresh?

Reconnect?

Room creation?

Room deletion?

Sequence IDs?

Ordering?

Duplicate packets?

Out-of-order packets?

Heartbeat?

Compression?

Backpressure?

Memory cleanup?

Connection limits?

Scaling?

NGINX?

Sticky Sessions?

Load Balancer?

EC2?

Health checks?

Metrics?

Alerts?

Testing?
Same for FCM

Instead of

Send notification.

We'll answer

Who triggers?

Backend event?

Queue?

Retry?

Priority?

TTL?

Collapse key?

Localization?

Topic?

Device token?

Background?

Foreground?

Notification payload?

Data payload?

Deduplication?

Expiration?

Security?

Testing?
Same for Security

We'll answer every major class of attack:

Authentication bypass
Authorization bypass
Replay attacks
QR forgery
QR replacement
QR screenshot attacks
GPS spoofing
Mock location
Root detection
MITM
JWT theft
Refresh token theft
Session fixation
Multiple device login
Device hijacking
WebSocket hijacking
Subscription hijacking
DoS
DDoS
Flooding
Rate limiting
SQL Injection
XSS
CSRF
Privilege escalation
Insider attacks
Audit tampering
Data leakage
PII exposure
Encryption
Incident response
Target Quality

This document should be detailed enough that:

A new engineer could implement the system without guessing.
An architecture reviewer can understand every design decision.
Your university can evaluate the design independently of the code.
Future contributors know exactly what the intended behavior is.
Every implementation milestone maps back to a specific chapter.