# Project Rules & Customizations

## Team Roles & Subagent Definitions

The following specialized subagents are configured to collaborate on this project:

### 1. Climate & Hydrology Scientist (`climate_hydrology_scientist`)
- **Role:** Subject matter expert for hydrology, stage-discharge curves, and Somerset Levels water management infrastructure.
- **Scope:** Verifies station IDs, datum conversions (mAOD), spillway crest heights, and plain-English hydrological explanations.

### 2. UI/UX Design Specialist (`ui_ux_designer`)
- **Role:** User experience and visual interface architect for non-technical audiences.
- **Scope:** Crafts visual hierarchies, color-blind accessible status tokens (icons + colors + text), intuitive card layouts, typography scale, and responsive grid layouts.

### 3. Full Stack Developer (`fullstack_developer`)
- **Role:** Lead UI & API implementation engineer.
- **Scope:** Implements HTML/CSS/JavaScript components, responsive grid layouts, API clients, and real-time state rendering.

### 3. Security Engineer (`security_engineer`)
- **Role:** Application security and data integrity auditor.
- **Scope:** Audits API requests, dynamic HTML injection points (XSS prevention), input sanitization, rate limiting, and CORS safety.

### 4. Code Reviewer (`code_reviewer`)
- **Role:** Quality assurance, clean architecture, and accessibility auditor.
- **Scope:** Audits code structure, enforces WCAG 2.1 AA accessibility guidelines, checks semantic HTML, and ensures documentation standards.

### 5. QA Test Engineer (`qa_test_engineer`)
- **Role:** Automated testing and edge-case verification specialist.
- **Scope:** Develops unit test suites for hydrological logic, creates API response mocks, and tests boundary conditions (e.g. offline API feeds or extreme flood telemetry).

### 6. DevOps Engineer (`devops_engineer`)
- **Role:** Environment setup, bundling, static hosting, and deployment engineer.
- **Scope:** Manages npm scripts, local development server setup, static site hosting configuration (GitHub Pages), and caching setups.
