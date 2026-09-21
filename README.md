# AI Meeting Summarizer

AI Meeting Summarizer is a web-based application that converts meeting conversations into concise, structured summaries using artificial intelligence.

The application captures meeting audio directly from the browser, transcribes the conversation using Faster-Whisper, and uses a local LLM through Ollama to generate an easy-to-read meeting summary.

## Features

- 🎙️ Browser-based meeting audio recording
- 📝 Automatic speech-to-text transcription
- 🤖 AI-powered meeting summarization
- 🧠 Local LLM processing using Ollama
- 🦙 Llama 3.2 support
- 📌 Extraction of important discussion points
- 📋 Structured meeting summaries
- 💾 SQLite database for storing meeting data
- 🌐 Modern web interface
- 🔒 Local AI processing
- ⚡ Fully local development workflow

## Technology Stack

| Technology | Purpose |
|---|---|
| Python | Backend programming |
| Flask | Web application framework |
| Faster-Whisper | Speech-to-text transcription |
| Ollama | Local AI model runtime |
| Llama 3.2 | Meeting summarization |
| SQLite | Local database |
| HTML | Web page structure |
| CSS | User interface styling |
| JavaScript | Browser interaction and audio recording |

## Project Structure
```text
AI-MEETING-SUMMARIZER/
│
├── app/
│   ├── __init__.py
│   ├── routes.py
│   ├── transcriber.py
│   ├── summarizer.py
│   └── database.py
│
├── static/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── script.js
│   └── assets/
│
├── templates/
│   └── index.html
│
├── instance/
│   └── meetings.db
│
├── uploads/
│
├── requirements.txt
├── run.py
├── README.md
└── LICENSE

Main Components:-
app/ — Core Flask application
routes.py — Handles application routes and requests
transcriber.py — Handles speech-to-text processing
summarizer.py — Handles AI-powered meeting summarization
database.py — Handles SQLite database operations
static/ — Contains CSS, JavaScript, and frontend assets
templates/ — Contains HTML templates
instance/ — Stores local application data and database files
uploads/ — Stores uploaded or recorded meeting audio
requirements.txt — Python dependencies
run.py — Application entry point
README.md — Project documentation
LICENSE — Project license

How It Works:-
Meeting Audio
      ↓
Browser Audio Capture
      ↓
Flask Backend
      ↓
Faster-Whisper
      ↓
Meeting Transcript
      ↓
Ollama / Llama 3.2
      ↓
AI Processing
      ↓
Structured Meeting Summary
      ↓
Web Interface

Project Workflow:-
Open the web application.
Start recording the meeting from the browser.
Record the conversation.
Stop the recording.
The audio is sent to the backend.
Faster-Whisper converts the speech into text.
The transcript is processed by the local Llama 3.2 model through Ollama.
The AI generates a structured meeting summary.
The final summary is displayed in the web interface.
Meeting information can be stored locally using SQLite.

AI Processing Pipeline:-
1. Audio Recording
The application uses the browser to capture meeting audio.

2. Speech Recognition
Faster-Whisper processes the recorded audio and generates a text transcript.

3. AI Summarization
The transcript is passed to Llama 3.2 through Ollama.
The model processes the conversation and produces a concise and structured summary.

4. Database Storage
SQLite provides local storage for meeting-related information.

Meeting Summary:-
The application is designed to transform long meeting conversations into useful information such as:
Meeting overview
Main discussion points
Important information
Decisions
Action items
Key takeaways

Flask Backend:-
The Flask backend manages the main application workflow, including:
Web requests
Audio handling
Transcription
AI processing
Database operations
Returning results to the frontend

Faster-Whisper:-
Faster-Whisper is used for speech-to-text transcription.
It converts the recorded meeting audio into a text transcript that can then be processed by the language model.

Ollama + Llama 3.2:-
Ollama provides the local runtime for the language model.
Llama 3.2 processes the meeting transcript and generates the final AI summary.
This allows the project to perform AI processing locally instead of depending on a cloud-based AI API.

SQLite Database:-
SQLite is used as the local database.
It provides lightweight storage for meeting-related application data without requiring a separate database server.

Browser Audio Capture:-
The frontend allows users to record meeting audio directly through the browser.
This creates a simple workflow where users can start and stop recording without requiring a separate desktop recording application.

Installation:-
Clone the Repository
git clone https://github.com/Bhushangcoe/AI-MEETING-SUMMARIZER.git
cd AI-MEETING-SUMMARIZER
Create a Virtual Environment
python -m venv .venv
Activate the Virtual Environment
.venv\Scripts\activate
Install Dependencies
pip install -r requirements.txt

Setup Ollama
Install Ollama and make sure it is running.
Pull the required model:
ollama pull llama3.2
Check the installed model:
ollama list

Run the Application
Start the Flask application using the project's configured entry point:
python run.py
Then open the application in your web browser.

Architecture
                    ┌─────────────────────┐
                    │       Browser       │
                    │                     │
                    │  HTML / CSS / JS    │
                    │  Audio Recording    │
                    └──────────┬──────────┘
                               │
                               ↓
                    ┌─────────────────────┐
                    │       Flask         │
                    │      Backend        │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    ↓                     ↓
          ┌─────────────────┐   ┌─────────────────┐
          │ Faster-Whisper  │   │     SQLite      │
          │ Speech-to-Text  │   │    Database     │
          └────────┬────────┘   └─────────────────┘
                   │
                   ↓
          ┌─────────────────┐
          │   Transcript    │
          └────────┬────────┘
                   │
                   ↓
          ┌─────────────────┐
          │     Ollama      │
          │    Llama 3.2    │
          └────────┬────────┘
                   │
                   ↓
          ┌─────────────────┐
          │  AI Summary     │
          └────────┬────────┘
                   │
                   ↓
          ┌─────────────────┐
          │ Browser Output  │
          └─────────────────┘

Privacy
The project is designed around local AI processing.
Speech transcription and AI summarization can be performed locally using Faster-Whisper and Ollama, reducing the need to send meeting content to external AI services.
Meeting data can also be stored locally using SQLite.

Project Goals
The goal of the project is to make meeting documentation faster and easier by automatically converting spoken conversations into useful, structured summaries.
Future development may include:
Speaker identification
Improved action-item extraction
Multiple summary formats
Meeting search
Summary export
Additional local AI models
Improved transcription accuracy
Better meeting organization

Future Development
Possible future improvements include:
👥 Speaker diarization
📄 PDF summary export
📑 DOCX summary export
🔎 Meeting search
🗂️ Meeting history
🎯 Improved action-item detection
🌍 Multi-language transcription
🤖 Support for additional local LLMs

Local AI Architecture
                    Local Computer
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ↓                             ↓
   Faster-Whisper                    Ollama
          │                             │
          ↓                             ↓
    Transcription                  Llama 3.2
          │                             │
          └──────────────┬──────────────┘
                         ↓
                  Meeting Summary
The application is designed to keep the main AI workflow local, providing a foundation for privacy-focused meeting analysis.

Author
Bhushan Gangurde
Computer Engineering Graduate
Data Science & AI/ML Enthusiast
GitHub: https://github.com/Bhushangcoe

License
This project is licensed under the terms specified in the LICENSE file.
