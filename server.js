const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// --- KONFIGURACJA KLUCZY ---
const geminiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(k => k && k.trim() !== "");

let currentGeminiIndex = 0;
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

app.use(express.static('public'));

// --- UNIWERSALNA ROTACJA GEMINI ---
async function tryGemini(prompt, fileData = null, attempt = 0) {
    if (attempt >= geminiKeys.length) throw new Error("BLOKADA_IP");
    const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex].trim());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });
    try {
        console.log(`[Gemini] Próba (Klucz ${currentGeminiIndex + 1})...`);
        const result = fileData ? await model.generateContent([prompt, fileData]) : await model.generateContent(prompt);
        return (await result.response).text();
    } catch (error) {
        currentGeminiIndex = (currentGeminiIndex + 1) % geminiKeys.length;
        return tryGemini(prompt, fileData, attempt + 1);
    }
}

// --- GŁÓWNA OBSŁUGA ZADANIA (Multi-Subject Prompt) ---
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie!" });

        const { subject, level } = req.body;
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        // DYNAMICZNY PROMPT ZALEŻNY OD PRZEDMIOTU
        let subjectInstruction = "";
        if (subject.toLowerCase().includes("polski")) {
            subjectInstruction = "Analizuj tekst literacki, gramatykę lub kontekst historyczny. Podaj konkretną interpretację lub odpowiedź na pytanie do tekstu.";
        } else if (subject.toLowerCase().includes("fizyka")) {
            subjectInstruction = "Wypisz dane i szukane. Podaj wzory fizyczne i jednostki. Pamiętaj o zamianie jednostek na układ SI (m, kg, s).";
        } else if (subject.toLowerCase().includes("matematyka")) {
            subjectInstruction = "Podaj czyste obliczenia krok po kroku. Sprawdź dwukrotnie znaki i pierwiastki.";
        } else {
            subjectInstruction = "Rozwiąż zadanie zgodnie z zasadami tego przedmiotu, skupiając się na konkretach.";
        }

        const finalPrompt = `Jesteś ekspertem z przedmiotu: ${subject}. Poziom: ${level}.
        ZADANIE: Rozwiąż zadanie ze zdjęcia.
        
        INSTRUKCJA SPECJALISTYCZNA: ${subjectInstruction}
        
        WYMAGANIA:
        1. ZERO lania wody i zbędnych komentarzy o procesie myślowym.
        2. Używaj $...$ dla wzorów i obliczeń.
        3. Najważniejsze etapy i wyniki pośrednie zapisuj jako \`[WAŻNE: wynik/wniosek]\`.
        
        STRUKTURA:
        - Rozwiązanie merytoryczne.
        - ### WYNIK KOŃCOWY: **$...$** (lub pogrubiony tekst dla przedmiotów humanistycznych).`;

        try {
            const result = await tryGemini(finalPrompt, { inlineData: { data: base64Data, mimeType } });
            return res.json({ result });
        } catch (e) {
            console.log("❌ Gemini padło. Uruchamiam Llama 4 Scout...");
            if (groq) {
                const response = await groq.chat.completions.create({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct", 
                    messages: [{ role: "user", content: [{ type: "text", text: finalPrompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }] }],
                    temperature: 0.1
                });
                return res.json({ result: response.choices[0].message.content });
            }
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- CZAT SPOFY (Z poprawioną logiką) ---
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const chatPrompt = `Kontekst zadania: ${context}\nUżytkownik pyta: ${question}\nOdpowiedz jako korepetytor SPOFY (krótko, konkretnie, merytorycznie).`;
        try {
            const answer = await tryGemini(chatPrompt);
            return res.json({ answer });
        } catch (e) {
            if (groq) {
                const response = await groq.chat.completions.create({
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: chatPrompt }]
                });
                return res.json({ answer: response.choices[0].message.content });
            }
            throw new Error("Offline");
        }
    } catch (error) {
        res.status(500).json({ error: "Czat offline." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SPOFY LIVE: All Subjects & Chat Ready`));
