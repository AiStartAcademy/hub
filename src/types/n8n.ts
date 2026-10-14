export interface N8nLessonJsonData {
  lesson_title: string;
  short_description: string;
  long_description: string;
  estimated_duration_minutes: string;
  keywords: string[];
  quiz_questions: Array<{
    question: string;
    options: string[];
    correct_answer: string;
    explanation: string;
  }>;
  timestamps: Array<{
    text: string;
    start: string;
    end: string;
    speaker_id: string | null;
    type: string;
  }>;
}

export interface N8nLessonPayload {
  folderName: string;
  videoUrl: string;
  audioUrl: string;
  captionsUrl: string;
  dataUrl: string;
  jsonData: N8nLessonJsonData;
}

export interface N8nModuleCallbackPayload {
  moduleId: string;
  moduleDescription: string;
  lessons: N8nLessonPayload[];
}

export type N8nQuizQuestion = N8nLessonJsonData["quiz_questions"][number];