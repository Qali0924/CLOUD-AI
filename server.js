const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// Zainicjuj API - upewnij się, że masz najnowszą wersję biblioteki: npm install @google/generative-ai
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static('public'));

app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, mode } = req.body;
        
        // ZMIANA: Próbujemy użyć nazwy 'gemini-1.5-flash', która jest najbardziej uniwersalna
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompts = {
            matematyka: "Jesteś ekspertem matematyki.",
            polski: "Jesteś polonistą.",
            fizyka: "Jesteś fizykiem.",
            inne: "Jesteś nauczycielem."
        };

        let basePrompt = prompts[subject] || prompts.inne;
        let styleInstruction = "";

        // Obsługa Trybu Ściąganie (Szybki i konkretny)
        if (mode === 'cheat') {
            styleInstruction = `
            TRYB SZYBKI (ŚCIĄGANIE): 
            - Pomiń wstępy i uprzejmości.
            - Podaj tylko konkretne kroki i wynik.
            - Bądź maksymalnie zwięzły.`;
        } else {
            styleInstruction = `
            TRYB STANDARDOWY: 
            - Wyjaśnij zadanie krok po kroku, aby uczeń zrozumiał materiał.`;
        }

        const finalPrompt = `
        ${basePrompt}
        ${styleInstruction}
        ZASADY: 1. Wzory w $...$. 2. Wynik końcowy w **$...$**. 3. Odpowiadaj po polsku.`;

        const result = await model.generateContent([
            finalPrompt,
            { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } }
        ]);

        const response = await result.response;
        res.json({ result: response.text() });

    } catch (error) {
        console.error("Błąd szczegółowy:", error);
        
        // Obsługa błędu 429 (Limit)
        if (error.status === 429) {
            return res.status(429).json({ error: "Limit zapytań wyczerpany. Odczekaj 60 sekund. ⏳" });
        }
        
        // Obsługa błędu 404 (Zła nazwa modelu)
        if (error.status === 404) {
            return res.status(404).json({ error: "Model AI nieodnaleziony. Sprawdź konfigurację API. 🛠️" });
        }

        res.status(500).json({ error: "Błąd serwera: " + error.message });
    }
});

// Pozostała część kodu (/chat i listen)...
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serwer śmiga na porcie ${PORT}`));
