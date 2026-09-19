from flask import Flask, render_template, request, jsonify
from faster_whisper import WhisperModel
import requests
import os
import tempfile
import json
import sqlite3
from datetime import datetime

app = Flask(__name__)


# ============================================================
# CONFIGURATION
# ============================================================

OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2"

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

DATABASE = os.path.join(
    BASE_DIR,
    "meeting_history.db"
)


# ============================================================
# DATABASE
# ============================================================

def get_db_connection():
    connection = sqlite3.connect(
        DATABASE
    )

    connection.row_factory = sqlite3.Row

    return connection


def initialize_database():
    connection = get_db_connection()

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS meetings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            transcript TEXT NOT NULL,
            summary TEXT NOT NULL
        )
        """
    )

    connection.commit()
    connection.close()

    print("Meeting database initialized.")


initialize_database()


# ============================================================
# WHISPER
# ============================================================

print("Loading Whisper model...")

whisper_model = WhisperModel(
    "base",
    device="cpu",
    compute_type="int8"
)

print("Whisper model loaded.")


# ============================================================
# MAIN PAGE
# ============================================================

@app.route("/")
def home():
    return render_template(
        "index.html"
    )


# ============================================================
# LIVE TRANSCRIPTION
# ============================================================

@app.route(
    "/api/transcribe-chunk",
    methods=["POST"]
)
def transcribe_chunk():

    if "audio" not in request.files:
        return jsonify({
            "success": False,
            "error": "No audio chunk received."
        }), 400

    audio_file = request.files["audio"]

    if audio_file.filename == "":
        return jsonify({
            "success": False,
            "error": "Empty audio chunk."
        }), 400

    segment_id = request.form.get(
        "segment_id",
        "unknown"
    )

    temp_path = None

    try:

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".webm"
        ) as temp_file:

            audio_file.save(
                temp_file.name
            )

            temp_path = temp_file.name

        file_size = os.path.getsize(
            temp_path
        )

        print(
            f"Live audio segment "
            f"{segment_id} received. "
            f"Size: {file_size} bytes"
        )

        if file_size < 1000:
            return jsonify({
                "success": True,
                "segment_id": segment_id,
                "transcript": ""
            })

        print(
            f"Starting Whisper transcription "
            f"for segment {segment_id}..."
        )

        segments, info = whisper_model.transcribe(
            temp_path,
            beam_size=5,
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 350,
                "speech_pad_ms": 300
            },
            language="en",
            condition_on_previous_text=False,
            temperature=0.0
        )

        transcript_parts = []

        for segment in segments:

            text = segment.text.strip()

            if text:
                transcript_parts.append(
                    text
                )

        transcript = " ".join(
            transcript_parts
        ).strip()

        print(
            f"Segment {segment_id} transcription:",
            transcript
            if transcript
            else "[no speech]"
        )

        return jsonify({
            "success": True,
            "segment_id": segment_id,
            "transcript": transcript
        })

    except Exception as e:

        print(
            "TRANSCRIPTION ERROR:",
            repr(e)
        )

        return jsonify({
            "success": False,
            "segment_id": segment_id,
            "error": str(e)
        }), 500

    finally:

        if (
            temp_path and
            os.path.exists(temp_path)
        ):
            try:
                os.remove(temp_path)
            except Exception:
                pass


# ============================================================
# AI SUMMARY
# ============================================================

@app.route(
    "/api/generate-summary",
    methods=["POST"]
)
def generate_summary_route():

    data = request.get_json()

    if not data:
        return jsonify({
            "success": False,
            "error": "No data received."
        }), 400

    transcript = data.get(
        "transcript",
        ""
    ).strip()

    if not transcript:
        return jsonify({
            "success": False,
            "error": "Transcript is empty."
        }), 400

    try:

        print(
            "Generating structured AI summary..."
        )

        summary = generate_summary(
            transcript
        )

        return jsonify({
            "success": True,
            "summary": summary
        })

    except Exception as e:

        print(
            "SUMMARY ERROR:",
            repr(e)
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


def generate_summary(transcript):

    prompt = f"""
You are a professional AI meeting analysis assistant.

Analyze the meeting transcript below.

Return ONLY valid JSON.

Use EXACTLY this structure:

{{
    "overview": "Short overview of the meeting",
    "main_topics": [],
    "key_points": [],
    "decisions": [],
    "action_items": [
        {{
            "task": "Task description",
            "person": "Person responsible"
        }}
    ],
    "deadlines": [],
    "keywords": []
}}

Rules:

1. Do not invent information.
2. Only use information from the transcript.
3. If there are no decisions, return [].
4. If there are no action items, return [].
5. If there are no deadlines, return [].
6. If a person is unknown, use "Not specified".
7. Keep everything concise.
8. Return ONLY JSON.
9. Do not use Markdown.
10. Do not use code fences.

MEETING TRANSCRIPT:

{transcript}
"""

    payload = {
        "model": OLLAMA_MODEL,

        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a professional meeting "
                    "analysis assistant. "
                    "Return only valid JSON."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],

        "stream": False,

        "keep_alive": "30m",

        "options": {
            "temperature": 0.1,
            "num_predict": 700
        }
    }

    print(
        "Sending request to Ollama..."
    )

    response = requests.post(
        OLLAMA_URL,
        json=payload,
        timeout=180
    )

    print(
        "Ollama response status:",
        response.status_code
    )

    response.raise_for_status()

    data = response.json()

    if "message" not in data:
        raise RuntimeError(
            f"Unexpected Ollama response: {data}"
        )

    raw_summary = (
        data["message"]["content"]
        .strip()
    )

    if raw_summary.startswith("```"):
        raw_summary = (
            raw_summary
            .replace("```json", "")
            .replace("```", "")
            .strip()
        )

    try:

        structured_summary = json.loads(
            raw_summary
        )

    except json.JSONDecodeError:

        print(
            "Invalid JSON from Ollama:"
        )

        print(raw_summary)

        start = raw_summary.find("{")
        end = raw_summary.rfind("}")

        if (
            start != -1 and
            end != -1
        ):

            try:

                structured_summary = json.loads(
                    raw_summary[
                        start:end + 1
                    ]
                )

            except Exception:

                raise RuntimeError(
                    "Ollama returned invalid JSON."
                )

        else:

            raise RuntimeError(
                "Ollama returned invalid JSON."
            )

    return normalize_summary(
        structured_summary
    )


# ============================================================
# SUMMARY NORMALIZATION
# ============================================================

def normalize_summary(summary):

    if not isinstance(summary, dict):
        summary = {}

    overview = summary.get(
        "overview",
        "No overview available."
    )

    main_topics = summary.get(
        "main_topics",
        []
    )

    key_points = summary.get(
        "key_points",
        []
    )

    decisions = summary.get(
        "decisions",
        []
    )

    action_items = summary.get(
        "action_items",
        []
    )

    deadlines = summary.get(
        "deadlines",
        []
    )

    keywords = summary.get(
        "keywords",
        []
    )

    if not isinstance(
        main_topics,
        list
    ):
        main_topics = []

    if not isinstance(
        key_points,
        list
    ):
        key_points = []

    if not isinstance(
        decisions,
        list
    ):
        decisions = []

    if not isinstance(
        action_items,
        list
    ):
        action_items = []

    if not isinstance(
        deadlines,
        list
    ):
        deadlines = []

    if not isinstance(
        keywords,
        list
    ):
        keywords = []

    cleaned_actions = []

    for item in action_items:

        if isinstance(item, dict):

            cleaned_actions.append({
                "task": str(
                    item.get(
                        "task",
                        "Task not specified"
                    )
                ),
                "person": str(
                    item.get(
                        "person",
                        "Not specified"
                    )
                )
            })

        else:

            cleaned_actions.append({
                "task": str(item),
                "person": "Not specified"
            })

    return {
        "overview": str(
            overview
        ),

        "main_topics": [
            str(x)
            for x in main_topics
        ],

        "key_points": [
            str(x)
            for x in key_points
        ],

        "decisions": [
            str(x)
            for x in decisions
        ],

        "action_items":
            cleaned_actions,

        "deadlines": [
            str(x)
            for x in deadlines
        ],

        "keywords": [
            str(x)
            for x in keywords
        ]
    }


# ============================================================
# SAVE MEETING
# ============================================================

@app.route(
    "/api/meetings",
    methods=["POST"]
)
def save_meeting():

    data = request.get_json()

    if not data:
        return jsonify({
            "success": False,
            "error": "No meeting data received."
        }), 400

    transcript = data.get(
        "transcript",
        ""
    ).strip()

    summary = data.get(
        "summary"
    )

    title = data.get(
        "title",
        ""
    ).strip()

    if not transcript:
        return jsonify({
            "success": False,
            "error": "Transcript is empty."
        }), 400

    if not summary:
        return jsonify({
            "success": False,
            "error": "Summary is missing."
        }), 400

    try:

        if not title:

            now = datetime.now()

            title = (
                "Meeting - "
                + now.strftime(
                    "%d %b %Y, %I:%M %p"
                )
            )

        created_at = (
            datetime.now()
            .isoformat(
                timespec="seconds"
            )
        )

        summary_json = json.dumps(
            summary,
            ensure_ascii=False
        )

        connection = (
            get_db_connection()
        )

        cursor = connection.execute(
            """
            INSERT INTO meetings
            (title, created_at, transcript, summary)
            VALUES (?, ?, ?, ?)
            """,
            (
                title,
                created_at,
                transcript,
                summary_json
            )
        )

        meeting_id = cursor.lastrowid

        connection.commit()
        connection.close()

        print(
            f"Meeting saved with ID: "
            f"{meeting_id}"
        )

        return jsonify({
            "success": True,
            "meeting_id": meeting_id,
            "title": title
        })

    except Exception as e:

        print(
            "SAVE MEETING ERROR:",
            repr(e)
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================
# GET ALL MEETINGS
# ============================================================

@app.route(
    "/api/meetings",
    methods=["GET"]
)
def get_meetings():

    try:

        connection = (
            get_db_connection()
        )

        rows = connection.execute(
            """
            SELECT
                id,
                title,
                created_at
            FROM meetings
            ORDER BY id DESC
            """
        ).fetchall()

        connection.close()

        meetings = []

        for row in rows:

            meetings.append({
                "id": row["id"],
                "title": row["title"],
                "created_at":
                    row["created_at"]
            })

        return jsonify({
            "success": True,
            "meetings": meetings
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================
# GET SINGLE MEETING
# ============================================================

@app.route(
    "/api/meetings/<int:meeting_id>",
    methods=["GET"]
)
def get_meeting(meeting_id):

    try:

        connection = (
            get_db_connection()
        )

        row = connection.execute(
            """
            SELECT
                id,
                title,
                created_at,
                transcript,
                summary
            FROM meetings
            WHERE id = ?
            """,
            (meeting_id,)
        ).fetchone()

        connection.close()

        if not row:

            return jsonify({
                "success": False,
                "error": "Meeting not found."
            }), 404

        try:

            summary = json.loads(
                row["summary"]
            )

        except Exception:

            summary = {
                "overview":
                    row["summary"],
                "main_topics": [],
                "key_points": [],
                "decisions": [],
                "action_items": [],
                "deadlines": [],
                "keywords": []
            }

        return jsonify({
            "success": True,

            "meeting": {
                "id": row["id"],
                "title": row["title"],
                "created_at":
                    row["created_at"],
                "transcript":
                    row["transcript"],
                "summary":
                    normalize_summary(
                        summary
                    )
            }
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================
# DELETE MEETING
# ============================================================

@app.route(
    "/api/meetings/<int:meeting_id>",
    methods=["DELETE"]
)
def delete_meeting(meeting_id):

    try:

        connection = (
            get_db_connection()
        )

        cursor = connection.execute(
            """
            DELETE FROM meetings
            WHERE id = ?
            """,
            (meeting_id,)
        )

        connection.commit()
        connection.close()

        if cursor.rowcount == 0:

            return jsonify({
                "success": False,
                "error": "Meeting not found."
            }), 404

        return jsonify({
            "success": True
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================
# SEARCH
# ============================================================

@app.route(
    "/api/search",
    methods=["GET"]
)
def search_meetings():

    query = request.args.get(
        "q",
        ""
    ).strip()

    if not query:

        return jsonify({
            "success": True,
            "results": []
        })

    try:

        connection = (
            get_db_connection()
        )

        pattern = f"%{query}%"

        rows = connection.execute(
            """
            SELECT
                id,
                title,
                created_at,
                transcript
            FROM meetings
            WHERE
                title LIKE ?
                OR transcript LIKE ?
                OR summary LIKE ?
            ORDER BY id DESC
            """,
            (
                pattern,
                pattern,
                pattern
            )
        ).fetchall()

        connection.close()

        results = []

        for row in rows:

            transcript = row[
                "transcript"
            ]

            lower_text = (
                transcript.lower()
            )

            lower_query = (
                query.lower()
            )

            index = lower_text.find(
                lower_query
            )

            if index >= 0:

                start = max(
                    0,
                    index - 100
                )

                end = min(
                    len(transcript),
                    index +
                    len(query) +
                    180
                )

                snippet = transcript[
                    start:end
                ]

            else:

                snippet = transcript[:280]

            results.append({
                "id": row["id"],
                "title": row["title"],
                "created_at":
                    row["created_at"],
                "snippet": snippet
            })

        return jsonify({
            "success": True,
            "results": results
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    app.run(
        debug=True,
        threaded=True
    )