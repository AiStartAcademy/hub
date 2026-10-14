'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown, PlayCircle, FileText, FileQuestion,
  Clock, Lock, Edit3, GripVertical,
} from 'lucide-react';
import Link from 'next/link';
import { LessonCreateButton } from './LessonCreateButton';
import { AssessmentCreateButton } from './AssessmentCreateButton';
import { ModuleEditButton } from './ModuleEditButton';
import { LessonEditButton } from './LessonEditButton';
import { AssessmentEditButton } from './AssessmentEditButton';

type Lesson = {
  id: string;
  name: string;
  type: string;
  duration: number | null;
  order: number;
};

type Assessment = {
  id: string;
  name: string;
  order: number;
  module: { programId: string };
};

type Module = {
  id: string;
  name: string;
  description: string | null;
  programId: string;
  program: { id: string; name: string };
  lessons: Lesson[];
  assessments: Assessment[];
};

type ProgramOption = {
  id: string;
  name: string;
};

interface ModuleAccordionProps {
  modules: any;
  programId: string;
  hasAccess: boolean;
  canManage: boolean;
  programs: ProgramOption[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Sortable Lesson Row ───────────────────────────────────────────────────

function SortableLessonRow({
  lesson,
  programId,
  hasAccess,
  canManage,
}: {
  lesson: Lesson;
  programId: string;
  hasAccess: boolean;
  canManage: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lesson.id, disabled: !canManage });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="p-4 flex items-center justify-between hover:bg-slate-50/30 dark:hover:bg-slate-800/10 transition-colors group/item"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {canManage && (
          <button
            {...attributes}
            {...listeners}
            className="p-1 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
            tabIndex={-1}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        {!canManage && <div className="w-4 ml-8" />}

        {hasAccess ? (
          <Link
            href={`/courses/${programId}/${lesson.id}`}
            className="flex items-center gap-3 flex-1 min-w-0"
          >
            {lesson.type === 'video' ? (
              <PlayCircle className="h-4 w-4 text-primary/60 flex-shrink-0" />
            ) : (
              <FileText className="h-4 w-4 text-primary/60 flex-shrink-0" />
            )}
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover/item:text-primary transition-colors truncate">
              {lesson.name}
            </span>
          </Link>
        ) : (
          <div className="flex items-center gap-3">
            {lesson.type === 'video' ? (
              <PlayCircle className="h-4 w-4 text-slate-300 dark:text-slate-600 flex-shrink-0" />
            ) : (
              <FileText className="h-4 w-4 text-slate-300 dark:text-slate-600 flex-shrink-0" />
            )}
            <span className="text-sm font-medium text-slate-400 dark:text-slate-600 flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              {lesson.name}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 min-w-[90px] justify-end flex-shrink-0">
        {canManage && (
          <>
            <Link
              href={`/courses/${programId}/${lesson.id}?mode=edit`}
              className="p-1 text-slate-400 hover:text-primary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded flex"
              title="Edit Content"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Link>
            <LessonEditButton lesson={lesson as any} />
          </>
        )}
        <span className="text-xs text-slate-400 font-medium flex items-center gap-1 w-[52px] justify-end tabular-nums">
          <Clock className="h-3 w-3" />
          {formatDuration(lesson.duration)}
        </span>
      </div>
    </div>
  );
}

// ─── Sortable Assessment Row ───────────────────────────────────────────────

function SortableAssessmentRow({
  assessment,
  programId,
  hasAccess,
  canManage,
}: {
  assessment: Assessment;
  programId: string;
  hasAccess: boolean;
  canManage: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: assessment.id, disabled: !canManage });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="p-4 flex items-center justify-between hover:bg-slate-50/30 dark:hover:bg-slate-800/10 transition-colors bg-amber-50/30 dark:bg-amber-900/5 group/item"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {canManage && (
          <button
            {...attributes}
            {...listeners}
            className="p-1 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
            tabIndex={-1}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        {!canManage && <div className="w-4 ml-8" />}

        {hasAccess ? (
          <Link
            href={`/courses/${programId}/${assessment.id}`}
            className="flex items-center gap-3 flex-1 min-w-0"
          >
            <FileQuestion className="h-4 w-4 text-amber-500/60 flex-shrink-0" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 group-hover/item:text-primary transition-colors truncate">
              {assessment.name}
            </span>
          </Link>
        ) : (
          <div className="flex items-center gap-3">
            <FileQuestion className="h-4 w-4 text-slate-300 dark:text-slate-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-slate-400 dark:text-slate-600 flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              {assessment.name}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 min-w-[90px] justify-end flex-shrink-0">
        {canManage && <AssessmentEditButton assessment={assessment} />}
        <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
          Assessment
        </span>
      </div>
    </div>
  );
}

// ─── Sortable Module Card ──────────────────────────────────────────────────

function SortableModuleCard({
  mod,
  idx,
  programId,
  hasAccess,
  canManage,
  isOpen,
  onToggle,
  onLessonsReorder,
  programs,
}: {
  mod: Module;
  idx: number;
  programId: string;
  hasAccess: boolean;
  canManage: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onLessonsReorder: (moduleId: string, lessons: Lesson[]) => void;
  programs: ProgramOption[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: mod.id, disabled: !canManage });

  const moduleStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [lessons, setLessons] = useState<Lesson[]>(mod.lessons);

  const handleLessonDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = lessons.findIndex((l) => l.id === active.id);
      const newIndex = lessons.findIndex((l) => l.id === over.id);
      const reordered = arrayMove(lessons, oldIndex, newIndex).map((l, i) => ({
        ...l,
        order: i,
      }));

      setLessons(reordered);
      onLessonsReorder(mod.id, reordered);

      console.log(`[ModuleAccordion] Saving lesson order for module ${mod.id}`);
      try {
        const res = await fetch('/api/lessons/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reordered.map(({ id, order }) => ({ id, order }))),
        });
        if (!res.ok) throw new Error('Failed to reorder lessons');
        console.log(`[ModuleAccordion] Lesson order saved`);
      } catch (err) {
        console.error('[ModuleAccordion] Lesson reorder error:', err);
      }
    },
    [lessons, mod.id, onLessonsReorder]
  );

  const itemCount = lessons.length + mod.assessments.length;
  // Combine lessons and assessments sorted by order for display
  const lessonIds = lessons.map((l) => l.id);

  return (
    <div
      ref={setNodeRef}
      style={moduleStyle}
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden group"
    >
      {/* Module Header */}
      <div
        className="p-6 flex justify-between items-center hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {canManage && (
            <button
              {...attributes}
              {...listeners}
              className="p-1 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-5 w-5" />
            </button>
          )}
          <div
            className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer select-none"
            onClick={onToggle}
          >
            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-500 flex-shrink-0">
              {idx + 1}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
                  {mod.name}
                </h3>
                {canManage && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <ModuleEditButton module={mod} programs={programs} />
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 line-clamp-1">
                {mod.description || 'No description.'}
              </p>
            </div>
          </div>
        </div>

        <div
          className="flex items-center gap-2 flex-shrink-0 cursor-pointer select-none"
          onClick={onToggle}
        >
          {canManage && (
            <span className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              <LessonCreateButton moduleId={mod.id} />
              <AssessmentCreateButton moduleId={mod.id} />
            </span>
          )}
          <span className="text-xs text-slate-400 font-medium mr-2">{itemCount} items</span>
          <ChevronDown
            className={`h-5 w-5 text-slate-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </div>
      </div>

      {/* Module Content */}
      {isOpen && (
        <div className="divide-y divide-slate-50 dark:divide-slate-800/50 border-t border-slate-100 dark:border-slate-800/50">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleLessonDragEnd}
          >
            <SortableContext items={lessonIds} strategy={verticalListSortingStrategy}>
              {lessons.map((lesson) => (
                <SortableLessonRow
                  key={lesson.id}
                  lesson={lesson}
                  programId={programId}
                  hasAccess={hasAccess}
                  canManage={canManage}
                />
              ))}
            </SortableContext>
          </DndContext>

          {mod.assessments.map((ass) => (
            <SortableAssessmentRow
              key={ass.id}
              assessment={ass}
              programId={programId}
              hasAccess={hasAccess}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ModuleAccordion ──────────────────────────────────────────────────

export function ModuleAccordion({ modules, programId, hasAccess, canManage, programs }: ModuleAccordionProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(modules.length === 1 ? [modules[0].id] : [])
  );
  const [moduleList, setModuleList] = useState<Module[]>(modules);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleModuleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = moduleList.findIndex((m) => m.id === active.id);
    const newIndex = moduleList.findIndex((m) => m.id === over.id);
    const reordered = arrayMove(moduleList, oldIndex, newIndex).map((m, i) => ({
      ...m,
      order: i,
    }));

    setModuleList(reordered);

    console.log('[ModuleAccordion] Saving module order');
    try {
      const res = await fetch('/api/modules/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reordered.map(({ id }, i) => ({ id, order: i }))),
      });
      if (!res.ok) throw new Error('Failed to reorder modules');
      console.log('[ModuleAccordion] Module order saved');
    } catch (err) {
      console.error('[ModuleAccordion] Module reorder error:', err);
    }
  }, [moduleList]);

  const handleLessonsReorder = useCallback((moduleId: string, lessons: Lesson[]) => {
    setModuleList((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, lessons } : m))
    );
  }, []);

  const moduleIds = moduleList.map((m) => m.id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleModuleDragEnd}
    >
      <SortableContext items={moduleIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-4">
          {moduleList.map((mod, idx) => (
            <SortableModuleCard
              key={mod.id}
              mod={mod}
              idx={idx}
              programId={programId}
              hasAccess={hasAccess}
              canManage={canManage}
              isOpen={openIds.has(mod.id)}
              onToggle={() => toggle(mod.id)}
              onLessonsReorder={handleLessonsReorder}
              programs={programs}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}