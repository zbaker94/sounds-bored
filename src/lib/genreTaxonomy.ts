export const GENRE_TAXONOMY: Record<string, string[]> = {
  "ambient": ["atmosphere", "atmospheric", "drone", "soundscape", "dark ambient"],
  "blues": ["blues rock", "delta blues", "chicago blues", "rhythm and blues"],
  "classical": ["orchestral", "chamber music", "baroque", "romantic", "contemporary classical", "symphony"],
  "country": ["americana", "bluegrass", "country rock", "outlaw country", "folk country"],
  "electronic": ["edm", "electronic dance music", "electronica", "idm", "intelligent dance music"],
  "folk": ["folk rock", "acoustic folk", "indie folk", "singer-songwriter", "traditional folk"],
  "funk": ["funk rock", "p-funk", "soul funk", "afrofunk"],
  "hip-hop": ["hip hop", "hiphop", "rap", "trap", "boom bap", "lo-fi hip hop"],
  "house": ["deep house", "tech house", "progressive house", "tropical house", "afro house"],
  "indie": ["indie rock", "indie pop", "indie folk", "alternative indie"],
  "jazz": ["bebop", "cool jazz", "free jazz", "fusion jazz", "jazz funk", "smooth jazz", "swing"],
  "latin": ["salsa", "bossa nova", "reggaeton", "cumbia", "latin pop", "merengue", "bachata"],
  "metal": ["heavy metal", "death metal", "black metal", "thrash metal", "doom metal", "metalcore"],
  "new-age": ["new age", "meditation music", "healing", "spa music", "yoga music"],
  "pop": ["synth-pop", "indie pop", "electropop", "k-pop", "dream pop", "bubblegum pop"],
  "punk": ["punk rock", "post-punk", "hardcore punk", "pop punk", "emo"],
  "r-and-b": ["r&b", "rnb", "soul", "neo soul", "contemporary r&b"],
  "reggae": ["dancehall", "dub", "ska", "roots reggae"],
  "rock": ["alternative rock", "hard rock", "classic rock", "garage rock", "psychedelic rock", "post-rock"],
  "soul": ["motown", "southern soul", "blue-eyed soul", "gospel"],
  "techno": ["detroit techno", "industrial techno", "minimal techno", "acid techno"],
  "trance": ["progressive trance", "psytrance", "psychedelic trance", "uplifting trance", "goa"],
  "world": ["african", "celtic", "middle eastern", "asian", "latin", "world music", "ethnic"],
};

export type Genre = keyof typeof GENRE_TAXONOMY;

export function resolveGenre(raw: string): string {
  const normalized = raw.toLowerCase().trim();
  for (const [canonical, synonyms] of Object.entries(GENRE_TAXONOMY)) {
    if (canonical === normalized || synonyms.includes(normalized)) {
      return canonical;
    }
  }
  return normalized;
}
