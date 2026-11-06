# QueryDesk — RAG Document Intelligence Platform

> Full-stack Retrieval-Augmented Generation (RAG) platform for conversational intelligence across business documents, internal policies, financial documentation, and operational knowledge bases.

---

## Overview

**QueryDesk** is an enterprise-grade document intelligence platform that allows users to upload unstructured business documentation and interact with it through natural-language conversation. By combining vector similarity search with large language model synthesis, QueryDesk provides accurate, context-aware answers directly grounded in source material.

### Problem Space

Modern organizations maintain vast quantities of operational knowledge trapped across heterogeneous files: PDF reports, Word documents, policy manuals, and standard operating procedures. Finding precise information traditionally requires time-consuming manual review or keyword search tools that lack semantic comprehension. Standard conversational LLMs can address natural-language queries but suffer from hallucination and lack visibility into proprietary, organization-specific data.

### Solution

QueryDesk resolves this by implementing a **Retrieval-Augmented Generation (RAG)** pipeline:
1. **Targeted Retrieval:** When a user asks a question, the platform searches a dedicated vector index for the most semantically relevant text passages within that conversation's documents.
2. **Context-Grounded Synthesis:** The retrieved excerpts are provided to an LLM as strict reference context, generating concise answers citing verifiable sources.
3. **Multi-Domain Intelligence:** While applicable to customer support operations, the platform is designed to query across diverse business documentation:
   - **Financial Documentation:** Quarterly reports, audit findings, earnings disclosures, and budgets.
   - **Corporate Policies & Operations:** Employee handbooks, HR protocols, compliance guidelines, and SOPs.
   - **Legal & Governance:** Terms of service, privacy disclosures, and contractual documentation.
   - **Technical & Product Manuals:** Engineering specifications, developer guides, and architecture records.
   - **General Business Documents:** Strategy memos, project plans, and meeting records.

---

## Table of Contents

- [Key Features](#key-features)
- [Architecture](#architecture)
- [RAG Workflow](#rag-workflow)
- [Technology Stack](#technology-stack)
- [Setup & Local Development](#setup--local-development)
- [Environment Variables](#environment-variables)
- [Platform Limitations & Roadmap](#platform-limitations--roadmap)

---

## Key Features

### Document Processing & Ingestion
- **Multi-Format In-Chat Uploads:** Direct ingestion of `.pdf`, `.docx`, and `.txt` files up to 10 MB per document.
- **Granular Processing Lifecycle:** Document processing tracking with real-time UI status reflection (`PENDING`, `READY`, and `FAILED` with actionable error reporting).
- **Text Extraction & Recursive Chunking:** Structured document text extraction paired with overlapping recursive character chunking to preserve semantic boundaries across section breaks.
- **High-Dimensional Vectorization:** Generation of 3,072-dimensional vector embeddings for every document chunk.

### Grounded Retrieval & Answer Synthesis
- **Context-Grounded Responses:** Answers synthesized exclusively from retrieved document chunks to eliminate hallucinations.
- **Verifiable Source Citations:** Every answer references source excerpts, presenting interactive cards detailing document filename, page number, similarity relevance score, and source quotes.
- **Chat-Isolated Retrieval Boundaries:** Vector searches are strictly partitioned using payload-level `chat_id` filtering, ensuring conversations query only their designated documents.

### Conversational Workspace
- **Multi-Thread Management:** Create, switch between, and manage up to 5 concurrent conversation threads per user account.
- **Automated Thread Naming:** Conversations dynamically inherit informative titles derived from the user's initial question, persisted to PostgreSQL.
- **Cursor-Based Scroll Pagination:** Chronological pagination for conversation history that fetches older message turns on top-scroll while preserving the user's viewport and scroll position.

### Authentication & Coordinated Lifecycle
- **Unified Authentication:** Email/password registration and Google OAuth sign-in powered by Better Auth, maintaining secure session cookies and user isolation.
- **Coordinated Resource Cleanup:** Single-click deletion of conversations or individual documents with coordinated cleanup across PostgreSQL records and Qdrant vector points.

---

## Architecture

QueryDesk is structured as a decoupled full-stack architecture comprising a Next.js application layer and a high-performance Python FastAPI microservice.

```text
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Frontend UI                     │
│  (React 19, Tailwind CSS v4, Lucide Icons, Chat Interface)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP (Session Cookie)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Next.js Route Handlers                    │
│   (/api/auth, /api/chats, /api/chats/[id]/documents, etc.)  │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
       Prisma 7 │                             │ HTTP (Internal Microservice)
                ▼                             ▼
┌───────────────────────────────┐  ┌──────────────────────────────────┐
│         PostgreSQL DB         │  │       FastAPI RAG Service        │
│  - Users & Session Cookies    │  │  - PyPDF & docx2txt Parsers      │
│  - Chat Thread Metadata       │  │  - LangChain Text Splitters      │
│  - Document Records & Status  │  │  - Similarity Retrieval Engine   │
│  - Conversation Turns/History │  │  - Context-Grounded Synthesis    │
└───────────────────────────────┘  └──────────┬──────────────┬────────┘
                                              │              │
                   Gemini API (Embeddings) /  │              │ Vector Search /
                   Groq API (Llama 3.3 70B)   ▼              ▼ Payload Filter
                                    ┌────────────────┐  ┌─────────────┐
                                    │  AI Services   │  │    Qdrant   │
                                    │ (Google / Groq)│  │ Vector DB   │
                                    └────────────────┘  └─────────────┘
```

### Component Roles

1. **Frontend UI (Next.js 16 / React 19):** Delivers an accessible, single-page conversational workspace with real-time upload indicators, Markdown answer formatting, source inspection cards, and mobile-responsive navigation.
2. **Web Application & API Layer (Next.js Route Handlers):** Enforces authentication via Better Auth, manages database transactions with Prisma ORM 7, validates file sizes/extensions, and orchestrates downstream requests to the RAG service.
3. **Relational Database (PostgreSQL):** Serves as the primary operational store for user profiles, session states, chat threads, document metadata (`PENDING`, `READY`, `FAILED`), and message turn history.
4. **RAG Microservice (FastAPI):** A specialized Python microservice managing text extraction, chunking, vector generation, similarity search, and prompt engineering.
5. **Vector Database (Qdrant Cloud):** Stores 3,072-dimensional document embeddings paired with keyword payload indexes on `chat_id` and `document_id` for filtered semantic search.
6. **AI Service Providers:**
   - **Google Gemini API (`models/text-embedding-004`):** Generates dense vector representations for document passages and query text.
   - **Groq API (`llama-3.3-70b-versatile`):** High-speed LLM inference synthesizing grounded answers from retrieved context.

---

## RAG Workflow

The core intelligence pipeline operates through two discrete workflows: **Document Ingestion** and **Question Answering**.

```text
DOCUMENT INGESTION
[User Document: PDF/DOCX/TXT]
       │
       ▼
[FastAPI /upload] ──► [Format Parsers] ──► [Text Extraction]
                                                   │
                                                   ▼
[Qdrant Collection] ◄── [Gemini Embeddings] ◄── [LangChain Splitter]
(Indexed by chat_id)    (3072-dim vectors)       (1000 char / 150 overlap)

QUESTION ANSWERING
[User Query]
       │
       ▼
[Gemini Query Embedding]
       │
       ▼
[Qdrant Similarity Search] (Filtered by chat_id, Top-K Chunks)
       │
       ▼
[Context-Augmented Prompt Construction] (Strict Grounding Rules)
       │
       ▼
[Groq LLM: Llama 3.3 70B]
       │
       ▼
[Answer Synthesis with Citations & Source Cards]
```

### 1. Document Ingestion Pipeline
1. **Upload & Initial Record:** The client posts a file to Next.js. Next.js creates a `Document` record in PostgreSQL marked `PENDING` and streams the file payload to FastAPI's `/upload` endpoint.
2. **Text Extraction:** FastAPI parses the raw bytes using `pypdf` for PDFs, `docx2txt` for Word documents, or UTF-8 decoding for plaintext files.
3. **Text Chunking:** Text is partitioned using LangChain's `RecursiveCharacterTextSplitter` configured with a chunk size of `1,000` characters and an overlap of `150` characters. This ensures continuity across split boundaries.
4. **Vector Embedding:** Document chunks are embedded in batches via Google Gemini (`models/text-embedding-004`), producing 3,072-dimensional vectors.
5. **Vector Indexing:** Vector points are inserted into Qdrant Cloud alongside metadata payloads (`chat_id`, `document_id`, `source`, `page`, and chunk text).
6. **Status Finalization:** Upon successful vectorization, the document record in PostgreSQL updates to `READY`. If extraction fails (e.g. empty file or scanned image without text), the status updates to `FAILED` with an explanatory error message.

### 2. Question Answering Pipeline
1. **Query Submission:** The user submits a natural-language query (up to 2,000 characters) within an active chat thread.
2. **Query Vectorization:** The question text is converted into an embedding vector using the identical Gemini model.
3. **Scoped Similarity Search:** FastAPI executes a cosine similarity search in Qdrant against the `support_documents` collection, constrained by a payload filter where `chat_id == current_chat_id`. The top matching chunks (default `top_k = 3`) are retrieved.
4. **Context Assembly:** If no relevant chunks are found, a fallback message is returned. Otherwise, retrieved passages are assembled into a structured context block labeled by source indices (`[Source 1]`, `[Source 2]`, etc.).
5. **Grounded Answer Generation:** The prompt enforces strict constraints requiring the Groq Llama 3.3 70B model to cite specific source numbers, refrain from fabricating unmentioned facts, and decline to answer if the context is insufficient.
6. **Persistence & Source Cards:** The response text and structured citation metadata (document name, page number, relevance score, text snippet) are saved in PostgreSQL as a `Turn` and displayed in the UI as an interactive response card.

---

## Technology Stack

| Domain | Technology | Version / Specification | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | Next.js | 16 (App Router) | Server-rendered pages, client routing, and layout |
| **UI Library** | React | 19 | Declarative UI state and components |
| **Styling** | Tailwind CSS | v4 | Modern styling and responsive layout |
| **Icons** | Lucide React | Latest | Interface iconography |
| **Application API** | Next.js Route Handlers | `app/api/*` | REST endpoints for auth, chats, and documents |
| **RAG Microservice** | FastAPI | 0.115+ (Python 3.10+) | High-throughput asynchronous RAG service |
| **ASGI Server** | Uvicorn | Standard | Asynchronous server execution |
| **Primary Database** | PostgreSQL | Neon / Standard PG | Relational store for users, chats, turns, documents |
| **ORM & Database Client** | Prisma ORM | 7 (`@prisma/adapter-pg`) | Type-safe database queries and migrations |
| **Authentication** | Better Auth | 1.7+ | Email/password, Google OAuth, session cookies |
| **Vector Database** | Qdrant Cloud | Cloud / Self-hosted | Dense vector indexing and payload-filtered search |
| **Embedding Model** | Google Gemini API | `models/text-embedding-004` | 3,072-dimensional text embeddings |
| **Generation Model** | Groq API | `llama-3.3-70b-versatile` | Context-grounded LLM response synthesis |
| **Document Processing** | PyPDF / docx2txt | Latest | PDF and DOCX text parsing |
| **Text Splitters** | LangChain Text Splitters | Latest | Overlapping recursive character chunking |

---

## Setup & Local Development

### Prerequisites

Ensure the following tools and services are installed and accessible:
- **Node.js:** `v20.x` or later with `npm`
- **Python:** `3.10` or later with `venv`
- **PostgreSQL Database:** A running instance (e.g., Neon Cloud or local PostgreSQL)
- **Qdrant Vector Database:** A Qdrant Cloud cluster or local instance
- **API Keys:**
  - Google Gemini API Key (for embeddings)
  - Groq API Key (for LLM inference)
  - Google OAuth Client ID & Secret (optional, for Google sign-in)

---

### 1. Next.js Web Application Setup

From the repository root directory:

```bash
# 1. Install Node.js dependencies
npm install

# 2. Configure environment variables (see Environment Variables section below)
# Create a .env file in the root directory

# 3. Synchronize database schema and generate the Prisma client
npx prisma db push
npx prisma generate

# 4. Start the Next.js development server
npm run dev
```

The web application will be accessible at `http://localhost:3000`.

---

### 2. FastAPI RAG Microservice Setup

Open a separate terminal window and navigate to the `rag-service` directory:

```bash
cd rag-service

# 1. Create and activate a Python virtual environment
python -m venv .venv

# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On macOS / Linux:
# source .venv/bin/activate

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Configure environment variables (see Environment Variables section below)
# Create a .env file in the rag-service directory

# 4. Initialize the Qdrant collection and payload indexes (one-time setup)
python setup_qdrant.py          # Creates 'support_documents' collection (3072 dimensions, cosine distance)
python setup_payload_indexes.py # Configures keyword payload indexes on chat_id and document_id

# 5. Start the FastAPI microservice
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The RAG service will run at `http://127.0.0.1:8000`.

---

## Environment Variables

### Root Application (`.env`)

Configure these variables in `.env` at the root of the project:

```env
# PostgreSQL connection string with SSL configuration
DATABASE_URL="postgresql://<user>:<password>@<host>/<database>?sslmode=require"

# Better Auth secret key and public canonical URL
BETTER_AUTH_SECRET="<random-32-byte-secret-key>"
BETTER_AUTH_URL="http://localhost:3000"

# URL of the internal Python FastAPI RAG service
RAG_SERVICE_URL="http://127.0.0.1:8000"

# Google OAuth credentials (optional, enables Google sign-in)
GOOGLE_CLIENT_ID="<your-google-client-id>.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="<your-google-client-secret>"
```

### RAG Service (`rag-service/.env`)

Configure these variables in `rag-service/.env`:

```env
# Google Gemini API key and embedding model
GEMINI_API_KEY="<your-gemini-api-key>"
GEMINI_EMBEDDING_MODEL="models/text-embedding-004"

# Groq API key and generation model
GROQ_API_KEY="<your-groq-api-key>"
GROQ_GENERATION_MODEL="llama-3.3-70b-versatile"

# Qdrant vector database credentials and collection name
QDRANT_URL="https://<cluster-id>.<region>.gcp.cloud.qdrant.io:6333"
QDRANT_API_KEY="<your-qdrant-api-key>"
QDRANT_COLLECTION="support_documents"
```

---

