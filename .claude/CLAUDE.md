# CLAUDE PROJECT MEMORY SYSTEM

You are the long-term engineer responsible for this repository.

Your primary goal is to preserve project knowledge across sessions, token limits, restarts, and computer shutdowns.

=================================================
PROJECT MEMORY RULES
====================

Always maintain project memory files.

Create and continuously update:

docs/
├── ARCHITECTURE.md
├── CURRENT_PROGRESS.md
├── NEXT_TASKS.md
├── HANDOFF.md
├── KNOWN_ISSUES.md
└── CHANGELOG.md

=================================================
PROJECT_ARCHITECTURE.md
=======================

Must contain:

* System architecture
* Folder structure
* State management
* Data flow
* WebSocket architecture
* Trading architecture
* Alert architecture
* Drawing architecture
* MT5 architecture
* Technology stack

Update whenever architecture changes.

=================================================
CURRENT_PROGRESS.md
===================

Track:

Completed Features

In Progress Features

Recently Modified Files

Current Milestone

Current Phase

Last Updated Date

Update after every meaningful task.

=================================================
NEXT_TASKS.md
=============

Track:

Immediate Tasks

Upcoming Tasks

Blocked Tasks

Priority Order

Estimated Complexity

Always keep this file current.

=================================================
HANDOFF.md
==========

This is the most important file.

Assume another AI agent must continue development.

Include:

Current Project State

Completed Work

Pending Work

Known Decisions

Important Files

Current Branch

Last Commit

Recommended Next Action

Update before ending every session.

=================================================
KNOWN_ISSUES.md
===============

Track:

Bugs

Limitations

Technical Debt

Workarounds

=================================================
CHANGELOG.md
============

Track all major changes.

Format:

Date
Feature
Files Modified

=================================================
SESSION END RULES
=================

Before ending any session:

1. Update CURRENT_PROGRESS.md
2. Update NEXT_TASKS.md
3. Update HANDOFF.md
4. Update CHANGELOG.md
5. Verify documentation accuracy

=================================================
GIT RULES
=========

After completing meaningful work:

Run:

git add .

Create meaningful commit messages.

Examples:

feat: implement realtime market data engine

feat: add tradingview drawing manager

feat: integrate mt5 bridge service

fix: resolve alert notification rendering

Then:

git push origin current-branch

Automatically detect current branch.

=================================================
TRADINGVIEW PROJECT CONTEXT
===========================

This project aims to become a TradingView-class platform.

Technology:

* React
* TypeScript
* TradingView Lightweight Charts
* Zustand
* WebSocket Realtime Data
* Firebase Push Notifications
* MT5 Integration

Architecture Principles:

* Single source of truth
* Centralized MarketDataStore
* Provider-based data services
* Production-ready code
* No mock data
* No duplicate architecture

=================================================
CODE RULES
==========

Never:

* Add fake market prices
* Add mock candles
* Create multiple websocket connections per symbol
* Create duplicate stores
* Introduce TODO placeholders

Always:

* Analyze existing architecture first
* Reuse existing services
* Preserve backward compatibility
* Update documentation

=================================================
STARTUP RULE
============

Whenever a new session starts:

1. Read HANDOFF.md
2. Read CURRENT_PROGRESS.md
3. Read NEXT_TASKS.md
4. Understand current project state
5. Continue from the latest milestone

Do not ask for project context if these files exist.

Treat these files as project memory.


At the end of every completed task:

1. Update documentation:
   - CURRENT_PROGRESS.md
   - NEXT_TASKS.md
   - HANDOFF.md
   - CHANGELOG.md

2. Validate build.

3. Run:
   git add .

4. Create a meaningful commit message.

5. Commit changes.

6. Push to the current branch.

7. Report commit hash and push status.

Never skip these steps unless explicitly instructed.
