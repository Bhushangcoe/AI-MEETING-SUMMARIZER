let mediaStream = null;
let audioStream = null;
let mediaRecorder = null;

let isRecording = false;
let isStopping = false;

let timerInterval = null;
let recordingSeconds = 0;

let fullTranscript = [];
let transcriptSegments = {};

let currentMeetingSummary = null;

let segmentNumber = 0;
let pendingUploads = 0;
let finalizing = false;

/* =========================================================
   ELEMENTS
========================================================= */

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const status = document.getElementById("status");
const statusBadge = document.getElementById("statusBadge");
const transcriptElement = document.getElementById("transcript");
const summaryElement = document.getElementById("summary");
const timerElement = document.getElementById("timer");
const recordButton = document.getElementById("recordButton");
const recordingGlow = document.getElementById("recordingGlow");
const waveform = document.getElementById("waveform");
const recordTitle = document.getElementById("recordTitle");
const recordDescription = document.getElementById("recordDescription");
const transcriptState = document.getElementById("transcriptState");
const pageTitle = document.getElementById("pageTitle");

/* =========================================================
   NAVIGATION
========================================================= */

const navItems = document.querySelectorAll(".nav-item");
const pages = document.querySelectorAll(".page");

const pageNames = {
    dashboardPage: "Meeting Dashboard",
    meetingsPage: "Your Meetings",
    searchPage: "Search Meetings",
    reportsPage: "Meeting Reports",
    reportViewPage: "Report"
};

function showPage(pageId) {
    pages.forEach(page => {
        page.classList.remove("active-page");
    });

    const target = document.getElementById(pageId);

    if (target) {
        target.classList.add("active-page");
    }

    navItems.forEach(item => {
        item.classList.toggle(
            "active",
            item.dataset.page === pageId
        );
    });

    if (pageTitle) {
        pageTitle.textContent =
            pageNames[pageId] || "Meeting Dashboard";
    }

    if (pageId === "meetingsPage") {
        loadMeetings();
    }

    if (pageId === "reportsPage") {
        loadReports();
    }
}

navItems.forEach(item => {
    item.addEventListener("click", () => {
        showPage(item.dataset.page);
    });
});

/* =========================================================
   TIMER
========================================================= */

function resetTimer() {
    recordingSeconds = 0;

    if (timerElement) {
        timerElement.textContent = "00:00";
    }
}

function startTimer() {
    clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        recordingSeconds++;

        const minutes = Math.floor(
            recordingSeconds / 60
        )
            .toString()
            .padStart(2, "0");

        const seconds = (
            recordingSeconds % 60
        )
            .toString()
            .padStart(2, "0");

        timerElement.textContent =
            `${minutes}:${seconds}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
}

/* =========================================================
   UI STATE
========================================================= */

function setStatus(type, text) {
    status.textContent = text;

    statusBadge.classList.remove(
        "idle",
        "recording",
        "processing"
    );

    if (type) {
        statusBadge.classList.add(type);
    }
}

function setRecordingUI(active) {
    if (active) {
        recordButton.classList.add("active");
        recordingGlow.classList.add("active");
        waveform.classList.add("active");

        recordTitle.textContent =
            "Meeting in progress";

        recordDescription.textContent =
            "Capturing shared device audio and transcribing it live.";

        transcriptState.textContent = "LIVE";
        transcriptState.classList.add("active");

    } else {
        recordButton.classList.remove("active");
        recordingGlow.classList.remove("active");
        waveform.classList.remove("active");

        transcriptState.textContent = "WAITING";
        transcriptState.classList.remove("active");
    }
}

/* =========================================================
   START MEETING
========================================================= */

startButton.addEventListener(
    "click",
    startMeeting
);

async function startMeeting() {
    if (isRecording) {
        return;
    }

    try {
        setStatus(
            "processing",
            "Requesting audio..."
        );

        mediaStream =
            await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

        const audioTracks =
            mediaStream.getAudioTracks();

        if (!audioTracks.length) {
            stopAllTracks();

            throw new Error(
                "No audio was shared. Please enable the audio sharing option."
            );
        }

        audioStream =
            new MediaStream(audioTracks);

        const videoTracks =
            mediaStream.getVideoTracks();

        if (videoTracks.length) {
            videoTracks[0].addEventListener(
                "ended",
                () => {
                    if (isRecording) {
                        stopMeeting();
                    }
                }
            );
        }

        /* Reset meeting state */
        fullTranscript = [];
        transcriptSegments = {};

        segmentNumber = 0;
        pendingUploads = 0;

        finalizing = false;

        resetTimer();
        clearTranscript();
        clearSummary();

        isRecording = true;
        isStopping = false;

        startButton.disabled = true;
        stopButton.disabled = false;

        setRecordingUI(true);

        setStatus(
            "recording",
            "Recording"
        );

        startTimer();

        /*
         * IMPORTANT:
         *
         * The recorder starts immediately.
         * Uploading/transcribing NEVER blocks
         * the next recording segment.
         */
        startRecordingSegment();

    } catch (error) {
        console.error(error);

        stopAllTracks();

        setStatus(
            "",
            "Ready"
        );

        setRecordingUI(false);

        alert(
            error.message ||
            "Unable to start audio capture."
        );
    }
}

/* =========================================================
   RECORDER OPTIONS
========================================================= */

function getRecorderOptions() {
    if (
        MediaRecorder.isTypeSupported(
            "audio/webm;codecs=opus"
        )
    ) {
        return {
            mimeType: "audio/webm;codecs=opus"
        };
    }

    if (
        MediaRecorder.isTypeSupported(
            "audio/webm"
        )
    ) {
        return {
            mimeType: "audio/webm"
        };
    }

    return {};
}

/* =========================================================
   CONTINUOUS SEGMENT RECORDING
========================================================= */

function startRecordingSegment() {
    if (
        !isRecording ||
        isStopping ||
        !audioStream ||
        !audioStream.getAudioTracks().length
    ) {
        return;
    }

    let recorder;

    try {
        recorder = new MediaRecorder(
            audioStream,
            getRecorderOptions()
        );
    } catch (error) {
        console.error(
            "Unable to create MediaRecorder:",
            error
        );

        finishMeeting();
        return;
    }

    mediaRecorder = recorder;

    const chunks = [];

    const currentSegment =
        segmentNumber++;

    recorder.ondataavailable = event => {
        if (
            event.data &&
            event.data.size > 0
        ) {
            chunks.push(event.data);
        }
    };

    recorder.onerror = event => {
        console.error(
            "MediaRecorder error:",
            event
        );
    };

    recorder.onstop = () => {
        const blob = new Blob(
            chunks,
            {
                type:
                    recorder.mimeType ||
                    "audio/webm"
            }
        );

        /*
         * Only clear the global recorder if
         * this is still the active recorder.
         */
        if (mediaRecorder === recorder) {
            mediaRecorder = null;
        }

        /*
         * IMPORTANT:
         *
         * Start the next recording FIRST.
         *
         * Do NOT wait for Whisper.
         */
        if (
            !isStopping &&
            isRecording
        ) {
            startRecordingSegment();
        }

        /*
         * Upload this segment independently.
         */
        if (blob.size > 1000) {
            pendingUploads++;

            sendAudioSegment(
                blob,
                currentSegment
            )
                .catch(error => {
                    console.error(
                        "Segment upload failed:",
                        error
                    );
                })
                .finally(() => {
                    pendingUploads--;

                    checkFinalization();
                });
        }

        /*
         * If Stop was pressed while this
         * recorder was running, finalize after
         * this final segment is uploaded.
         */
        if (isStopping) {
            checkFinalization();
        }
    };

    recorder.start();

    /*
     * 5-second recording segments.
     *
     * The next segment starts immediately
     * when this one stops, so Whisper
     * processing does not create a gap.
     */
    setTimeout(() => {
        if (
            recorder &&
            recorder.state === "recording"
        ) {
            recorder.stop();
        }
    }, 5000);
}

/* =========================================================
   SEND AUDIO
========================================================= */

async function sendAudioSegment(
    blob,
    segmentId
) {
    try {
        const formData =
            new FormData();

        formData.append(
            "audio",
            blob,
            `meeting_chunk_${segmentId}.webm`
        );

        formData.append(
            "segment_id",
            String(segmentId)
        );

        const response =
            await fetch(
                "/api/transcribe-chunk",
                {
                    method: "POST",
                    body: formData
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.error ||
                "Transcription failed."
            );
        }

        if (
            data.transcript &&
            data.transcript.trim()
        ) {
            const text =
                data.transcript.trim();

            /*
             * Store by segment number.
             *
             * Whisper may finish segment 4
             * before segment 3.
             *
             * We don't want the transcript
             * to appear out of order.
             */
            transcriptSegments[segmentId] =
                text;

            rebuildTranscript();
        }

    } catch (error) {
        console.error(
            `Audio processing error for segment ${segmentId}:`,
            error
        );

        /*
         * Don't stop the meeting because
         * one Whisper request failed.
         */
    }
}

/* =========================================================
   REBUILD TRANSCRIPT IN CORRECT ORDER
========================================================= */

function rebuildTranscript() {
    const orderedIds =
        Object.keys(transcriptSegments)
            .map(Number)
            .sort((a, b) => a - b);

    fullTranscript =
        orderedIds.map(
            id => transcriptSegments[id]
        );

    transcriptElement.innerHTML = "";

    if (!fullTranscript.length) {
        clearTranscript();
        return;
    }

    const container =
        document.createElement("div");

    container.className =
        "transcript-text";

    fullTranscript.forEach(text => {
        const line =
            document.createElement("div");

        line.className =
            "transcript-line";

        line.textContent = text;

        container.appendChild(line);
    });

    transcriptElement.appendChild(
        container
    );

    transcriptElement.scrollTop =
        transcriptElement.scrollHeight;
}

/* =========================================================
   STOP MEETING
========================================================= */

stopButton.addEventListener(
    "click",
    stopMeeting
);

function stopMeeting() {
    if (
        !isRecording ||
        isStopping
    ) {
        return;
    }

    isStopping = true;
    isRecording = false;

    stopButton.disabled = true;
    startButton.disabled = true;

    stopTimer();

    setStatus(
        "processing",
        "Processing meeting"
    );

    setRecordingUI(false);

    recordTitle.textContent =
        "Processing your meeting";

    recordDescription.textContent =
        "Finishing transcription and generating your AI report.";

    /*
     * Stop the current recorder.
     *
     * Its onstop handler will upload the
     * final segment.
     */
    if (
        mediaRecorder &&
        mediaRecorder.state === "recording"
    ) {
        mediaRecorder.stop();
    } else {
        checkFinalization();
    }
}

/* =========================================================
   FINALIZATION CHECK
========================================================= */

function checkFinalization() {
    if (!isStopping) {
        return;
    }

    /*
     * Wait until every audio segment
     * has finished uploading/transcribing.
     */
    if (pendingUploads > 0) {
        return;
    }

    /*
     * Give the browser a moment to finish
     * any final recorder event.
     */
    if (mediaRecorder) {
        return;
    }

    if (finalizing) {
        return;
    }

    finalizing = true;

    finishMeeting();
}

/* =========================================================
   FINISH MEETING
========================================================= */

async function finishMeeting() {
    stopAllTracks();

    /*
     * Rebuild one final time so the transcript
     * is guaranteed to be ordered.
     */
    rebuildTranscript();

    const transcript =
        fullTranscript
            .join(" ")
            .trim();

    if (!transcript) {
        setStatus(
            "",
            "No speech detected"
        );

        recordTitle.textContent =
            "No speech detected";

        recordDescription.textContent =
            "Try recording again and make sure the shared audio contains speech.";

        startButton.disabled = false;

        finalizing = false;

        return;
    }

    try {
        setStatus(
            "processing",
            "Generating AI summary"
        );

        summaryElement.innerHTML = `
            <div class="empty-summary">
                <div class="ai-orbit">
                    <div>✦</div>
                </div>

                <h4>
                    AI is analyzing your meeting
                </h4>

                <p>
                    Extracting topics, decisions,
                    actions and important details...
                </p>
            </div>
        `;

        const response =
            await fetch(
                "/api/generate-summary",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        transcript: transcript
                    })
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.error ||
                "Summary generation failed."
            );
        }

        currentMeetingSummary =
            data.summary;

        renderSummary(
            currentMeetingSummary
        );

        /*
         * Automatically save meeting.
         */
        await saveMeeting(
            transcript,
            currentMeetingSummary
        );

        setStatus(
            "",
            "Completed"
        );

        recordTitle.textContent =
            "Meeting completed";

        recordDescription.textContent =
            "Your transcript and AI report have been saved.";

        startButton.disabled = false;

        finalizing = false;

    } catch (error) {
        console.error(error);

        setStatus(
            "",
            "Error"
        );

        summaryElement.innerHTML = `
            <div class="empty-summary">
                <div class="empty-icon">!</div>

                <h4>
                    Something went wrong
                </h4>

                <p>
                    ${escapeHtml(error.message)}
                </p>
            </div>
        `;

        startButton.disabled = false;

        finalizing = false;
    }
}

/* =========================================================
   STOP TRACKS
========================================================= */

function stopAllTracks() {
    if (mediaStream) {
        mediaStream
            .getTracks()
            .forEach(track => {
                try {
                    track.stop();
                } catch (error) {
                    console.error(error);
                }
            });
    }

    if (audioStream) {
        audioStream
            .getTracks()
            .forEach(track => {
                try {
                    track.stop();
                } catch (error) {
                    console.error(error);
                }
            });
    }

    mediaStream = null;
    audioStream = null;
    mediaRecorder = null;
}

/* =========================================================
   TRANSCRIPT
========================================================= */

function clearTranscript() {
    transcriptElement.innerHTML = `
        <div class="empty-transcript">
            <div class="empty-icon">
                ◌
            </div>

            <h4>
                Listening for conversation...
            </h4>

            <p>
                Live transcription will appear here.
            </p>
        </div>
    `;
}

function appendTranscript(text) {
    if (
        transcriptElement
            .querySelector(".empty-transcript")
    ) {
        transcriptElement.innerHTML =
            `<div class="transcript-text"></div>`;
    }

    const container =
        transcriptElement
            .querySelector(".transcript-text");

    const line =
        document.createElement("div");

    line.className =
        "transcript-line";

    line.textContent = text;

    container.appendChild(line);

    transcriptElement.scrollTop =
        transcriptElement.scrollHeight;
}

/* =========================================================
   SUMMARY
========================================================= */

function clearSummary() {
    summaryElement.innerHTML = `
        <div class="empty-summary">
            <div class="ai-orbit">
                <div>✦</div>
            </div>

            <h4>
                Waiting for your meeting
            </h4>

            <p>
                Once your meeting ends, AI will extract
                the important information automatically.
            </p>
        </div>
    `;
}

function renderSummary(summary) {
    if (!summary) {
        return;
    }

    let html = "";

    if (summary.overview) {
        html += `
            <div class="summary-overview">
                <span class="section-label">
                    OVERVIEW
                </span>

                <p>
                    ${escapeHtml(summary.overview)}
                </p>
            </div>
        `;
    }

    html += renderListSection(
        "Main Topics",
        summary.main_topics
    );

    html += renderListSection(
        "Key Points",
        summary.key_points
    );

    html += renderListSection(
        "Decisions",
        summary.decisions
    );

    if (
        Array.isArray(summary.action_items) &&
        summary.action_items.length
    ) {
        html += `
            <div class="summary-section">
                <h4>Action Items</h4>

                ${summary.action_items.map(item => {
                    const task =
                        typeof item === "string"
                            ? item
                            : item.task || "";

                    const person =
                        typeof item === "object"
                            ? item.person ||
                              "Not specified"
                            : "";

                    return `
                        <div class="action-item">
                            <span>
                                ${escapeHtml(task)}
                            </span>

                            ${
                                person
                                    ? `
                                        <span class="action-person">
                                            ${escapeHtml(person)}
                                        </span>
                                      `
                                    : ""
                            }
                        </div>
                    `;
                }).join("")}
            </div>
        `;
    }

    html += renderListSection(
        "Deadlines",
        summary.deadlines
    );

    if (
        Array.isArray(summary.keywords) &&
        summary.keywords.length
    ) {
        html += `
            <div class="summary-section">
                <h4>Keywords</h4>

                <div class="keyword-list">
                    ${summary.keywords.map(
                        keyword => `
                            <span class="keyword">
                                ${escapeHtml(keyword)}
                            </span>
                        `
                    ).join("")}
                </div>
            </div>
        `;
    }

    summaryElement.innerHTML =
        html ||
        `
            <div class="empty-summary">
                <h4>No structured summary</h4>
            </div>
        `;
}

function renderListSection(title, items) {
    if (
        !Array.isArray(items) ||
        !items.length
    ) {
        return "";
    }

    return `
        <div class="summary-section">
            <h4>${escapeHtml(title)}</h4>

            <ul>
                ${items.map(
                    item => `
                        <li>
                            ${escapeHtml(item)}
                        </li>
                    `
                ).join("")}
            </ul>
        </div>
    `;
}

/* =========================================================
   SAVE MEETING
========================================================= */

async function saveMeeting(
    transcript,
    summary
) {
    try {
        const response =
            await fetch(
                "/api/meetings",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        transcript,
                        summary
                    })
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            console.error(
                "Meeting save failed:",
                data.error
            );

            return null;
        }

        return data;

    } catch (error) {
        console.error(
            "Save meeting error:",
            error
        );

        return null;
    }
}

/* =========================================================
   MEETINGS
========================================================= */

async function loadMeetings() {
    const container =
        document.getElementById(
            "meetingsList"
        );

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="loading-state">
            Loading meetings...
        </div>
    `;

    try {
        const response =
            await fetch(
                "/api/meetings"
            );

        const data =
            await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error ||
                "Unable to load meetings."
            );
        }

        if (!data.meetings.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No meetings yet</h3>

                    <p>
                        Your completed meetings
                        will appear here.
                    </p>
                </div>
            `;

            return;
        }

        container.innerHTML =
            data.meetings.map(
                meeting => `
                    <article
                        class="meeting-card"
                        data-id="${meeting.id}"
                    >
                        <button
                            class="delete-meeting"
                            data-delete-id="${meeting.id}"
                            title="Delete meeting"
                        >
                            ×
                        </button>

                        <div class="meeting-card-icon">
                            ▣
                        </div>

                        <h3>
                            ${escapeHtml(
                                meeting.title
                            )}
                        </h3>

                        <div class="meeting-date">
                            ${formatDate(
                                meeting.created_at
                            )}
                        </div>

                        <div class="meeting-open">
                            Open meeting →
                        </div>
                    </article>
                `
            ).join("");

        container
            .querySelectorAll(".meeting-card")
            .forEach(card => {
                card.addEventListener(
                    "click",
                    event => {
                        if (
                            event.target.closest(
                                ".delete-meeting"
                            )
                        ) {
                            return;
                        }

                        openMeeting(
                            card.dataset.id
                        );
                    }
                );
            });

        container
            .querySelectorAll(".delete-meeting")
            .forEach(button => {
                button.addEventListener(
                    "click",
                    event => {
                        event.stopPropagation();

                        deleteMeeting(
                            button.dataset.deleteId
                        );
                    }
                );
            });

    } catch (error) {
        console.error(error);

        container.innerHTML = `
            <div class="empty-state">
                Unable to load meetings.
            </div>
        `;
    }
}

const refreshMeetings =
    document.getElementById(
        "refreshMeetings"
    );

if (refreshMeetings) {
    refreshMeetings.addEventListener(
        "click",
        loadMeetings
    );
}

/* =========================================================
   OPEN MEETING
========================================================= */

async function openMeeting(id) {
    try {
        const response =
            await fetch(
                `/api/meetings/${id}`
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.error ||
                "Meeting not found."
            );
        }

        renderReport(
            data.meeting
        );

        showPage(
            "reportViewPage"
        );

    } catch (error) {
        alert(
            "Unable to open meeting: " +
            error.message
        );
    }
}

/* =========================================================
   DELETE MEETING
========================================================= */

async function deleteMeeting(id) {
    const confirmed =
        confirm(
            "Delete this meeting permanently?"
        );

    if (!confirmed) {
        return;
    }

    try {
        const response =
            await fetch(
                `/api/meetings/${id}`,
                {
                    method: "DELETE"
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.error ||
                "Delete failed."
            );
        }

        loadMeetings();

    } catch (error) {
        alert(
            "Unable to delete meeting: " +
            error.message
        );
    }
}

/* =========================================================
   REPORTS
========================================================= */

async function loadReports() {
    const container =
        document.getElementById(
            "reportsList"
        );

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="loading-state">
            Loading reports...
        </div>
    `;

    try {
        const response =
            await fetch(
                "/api/meetings"
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.error ||
                "Unable to load reports."
            );
        }

        if (!data.meetings.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No reports available</h3>

                    <p>
                        Complete a meeting to create
                        your first AI report.
                    </p>
                </div>
            `;

            return;
        }

        container.innerHTML =
            data.meetings.map(
                meeting => `
                    <article
                        class="report-row"
                        data-report-id="${meeting.id}"
                    >
                        <div class="report-icon">
                            ▤
                        </div>

                        <div class="report-info">
                            <h3>
                                ${escapeHtml(
                                    meeting.title
                                )}
                            </h3>

                            <span>
                                ${formatDate(
                                    meeting.created_at
                                )}
                            </span>
                        </div>

                        <div class="report-arrow">
                            →
                        </div>
                    </article>
                `
            ).join("");

        container
            .querySelectorAll(".report-row")
            .forEach(row => {
                row.addEventListener(
                    "click",
                    () => {
                        openMeeting(
                            row.dataset.reportId
                        );
                    }
                );
            });

    } catch (error) {
        console.error(error);

        container.innerHTML = `
            <div class="empty-state">
                Unable to load reports.
            </div>
        `;
    }
}

/* =========================================================
   REPORT VIEW
========================================================= */

function renderReport(meeting) {
    const container =
        document.getElementById(
            "reportContent"
        );

    const summary =
        meeting.summary || {};

    let html = `
        <div class="professional-report-header">
            <span class="section-label">
                MEETING REPORT
            </span>

            <h2>
                ${escapeHtml(meeting.title)}
            </h2>

            <p>
                ${formatDate(
                    meeting.created_at
                )}
            </p>
        </div>
    `;

    if (summary.overview) {
        html += `
            <div class="report-section">
                <h3>Overview</h3>

                <p>
                    ${escapeHtml(
                        summary.overview
                    )}
                </p>
            </div>
        `;
    }

    html += renderReportList(
        "Main Topics",
        summary.main_topics
    );

    html += renderReportList(
        "Key Points",
        summary.key_points
    );

    html += renderReportList(
        "Decisions",
        summary.decisions
    );

    if (
        Array.isArray(summary.action_items) &&
        summary.action_items.length
    ) {
        html += `
            <div class="report-section">
                <h3>Action Items</h3>

                <ul>
                    ${summary.action_items.map(
                        item => {
                            const task =
                                typeof item === "string"
                                    ? item
                                    : item.task || "";

                            const person =
                                typeof item === "object"
                                    ? item.person || ""
                                    : "";

                            return `
                                <li>
                                    ${escapeHtml(task)}

                                    ${
                                        person
                                            ? ` — <strong>
                                                ${escapeHtml(
                                                    person
                                                )}
                                              </strong>`
                                            : ""
                                    }
                                </li>
                            `;
                        }
                    ).join("")}
                </ul>
            </div>
        `;
    }

    html += renderReportList(
        "Deadlines",
        summary.deadlines
    );

    if (
        Array.isArray(summary.keywords) &&
        summary.keywords.length
    ) {
        html += `
            <div class="report-section">
                <h3>Keywords</h3>

                <div class="report-keywords">
                    ${summary.keywords.map(
                        keyword => `
                            <span class="keyword">
                                ${escapeHtml(
                                    keyword
                                )}
                            </span>
                        `
                    ).join("")}
                </div>
            </div>
        `;
    }

    html += `
        <div class="report-section">
            <h3>Transcript</h3>

            <p>
                ${escapeHtml(
                    meeting.transcript
                )}
            </p>
        </div>
    `;

    container.innerHTML = html;
}

function renderReportList(
    title,
    items
) {
    if (
        !Array.isArray(items) ||
        !items.length
    ) {
        return "";
    }

    return `
        <div class="report-section">
            <h3>
                ${escapeHtml(title)}
            </h3>

            <ul>
                ${items.map(
                    item => `
                        <li>
                            ${escapeHtml(item)}
                        </li>
                    `
                ).join("")}
            </ul>
        </div>
    `;
}

/* =========================================================
   BACK TO REPORTS
========================================================= */

const backToReports =
    document.getElementById(
        "backToReports"
    );

if (backToReports) {
    backToReports.addEventListener(
        "click",
        () => showPage("reportsPage")
    );
}

/* =========================================================
   SEARCH
========================================================= */

const searchInput =
    document.getElementById(
        "searchInput"
    );

const searchButton =
    document.getElementById(
        "searchButton"
    );

const searchResults =
    document.getElementById(
        "searchResults"
    );

async function performSearch() {
    const query =
        searchInput.value.trim();

    if (!query) {
        searchResults.innerHTML = `
            <div class="search-placeholder">
                <div>⌕</div>

                <h3>
                    Search your meeting memory
                </h3>

                <p>
                    Enter a keyword to find
                    conversations and reports.
                </p>
            </div>
        `;

        return;
    }

    searchResults.innerHTML = `
        <div class="loading-state">
            Searching...
        </div>
    `;

    try {
        const response =
            await fetch(
                `/api/search?q=${encodeURIComponent(query)}`
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.error ||
                "Search failed."
            );
        }

        if (!data.results.length) {
            searchResults.innerHTML = `
                <div class="search-placeholder">
                    <div>⌕</div>

                    <h3>
                        No results found
                    </h3>

                    <p>
                        No meetings matched
                        "${escapeHtml(query)}".
                    </p>
                </div>
            `;

            return;
        }

        searchResults.innerHTML =
            data.results.map(
                result => `
                    <article
                        class="search-result"
                        data-id="${result.id}"
                    >
                        <h3>
                            ${escapeHtml(
                                result.title
                            )}
                        </h3>

                        <div class="search-result-date">
                            ${formatDate(
                                result.created_at
                            )}
                        </div>

                        <p>
                            ${escapeHtml(
                                result.snippet
                            )}
                        </p>
                    </article>
                `
            ).join("");

        searchResults
            .querySelectorAll(".search-result")
            .forEach(result => {
                result.addEventListener(
                    "click",
                    () => {
                        openMeeting(
                            result.dataset.id
                        );
                    }
                );
            });

    } catch (error) {
        console.error(error);

        searchResults.innerHTML = `
            <div class="search-placeholder">
                <h3>
                    Search failed
                </h3>

                <p>
                    ${escapeHtml(
                        error.message
                    )}
                </p>
            </div>
        `;
    }
}

if (searchButton) {
    searchButton.addEventListener(
        "click",
        performSearch
    );
}

if (searchInput) {
    searchInput.addEventListener(
        "keydown",
        event => {
            if (event.key === "Enter") {
                performSearch();
            }
        }
    );
}

/* =========================================================
   HELPERS
========================================================= */

function formatDate(dateString) {
    if (!dateString) {
        return "";
    }

    const date =
        new Date(dateString);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return dateString;
    }

    return date.toLocaleString(
        undefined,
        {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}

function escapeHtml(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================================================
   INITIAL STATE
========================================================= */

showPage("dashboardPage");

setStatus(
    "",
    "Ready"
);

setRecordingUI(false);