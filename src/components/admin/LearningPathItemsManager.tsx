"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface LessonItem {
  id: string;
  order: number;
  lesson: {
    id: string;
    name: string;
    type: string;
    module: { name: string; program: { name: string } };
  };
}

interface LearningPathItemsManagerProps {
  pathId: string;
}

export function LearningPathItemsManager({ pathId }: LearningPathItemsManagerProps) {
  const router = useRouter();
  const [items, setItems] = useState<LessonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  useEffect(() => {
    fetchItems();
  }, [pathId]);

  const fetchItems = async () => {
    try {
      const res = await fetch(`/api/admin/learning-paths/${pathId}/items`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setItems(data.sort((a, b) => a.order - b.order));
      }
    } catch (error) {
      console.error("Failed to load items", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, position: number) => {
    dragItem.current = position;
    e.currentTarget.classList.add('opacity-50');
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, position: number) => {
    dragOverItem.current = position;
    e.preventDefault();
  };

  const handleDragEnd = async (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('opacity-50');
    
    if (dragItem.current !== null && dragOverItem.current !== null) {
      const newItems = [...items];
      const draggedItemContent = newItems[dragItem.current];
      
      newItems.splice(dragItem.current, 1);
      newItems.splice(dragOverItem.current, 0, draggedItemContent);
      
      const reorderedItems = newItems.map((item, index) => ({
        ...item,
        order: index
      }));

      setItems(reorderedItems);
      dragItem.current = null;
      dragOverItem.current = null;

      // Save new order to backend
      setSaving(true);
      try {
        await fetch(`/api/admin/learning-paths/${pathId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: reorderedItems.map(i => ({ id: i.id, order: i.order }))
          })
        });
        router.refresh();
      } catch (error) {
        console.error("Failed to save new order", error);
        alert("Failed to save order");
        fetchItems(); // Revert on failure
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!confirm("Remove this lesson from the path?")) return;
    try {
      setSaving(true);
      await fetch(`/api/admin/learning-paths/${pathId}/items/${itemId}`, {
        method: 'DELETE'
      });
      setItems(items.filter(item => item.id !== itemId));
      router.refresh();
    } catch (error) {
      console.error("Failed to remove item", error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading lessons...</div>;

  return (
    <div className="space-y-4">
      {saving && <div className="text-xs text-blue-500 flex justify-end">Saving changes...</div>}
      
      {items.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          No lessons added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className="flex cursor-grab items-center justify-between rounded border bg-white p-3 shadow-sm hover:border-blue-300"
            >
              <div className="flex items-center gap-3">
                <div className="cursor-grab text-gray-400">⋮⋮</div>
                <div>
                  <div className="font-medium text-sm">{item.lesson.name}</div>
                  <div className="text-xs text-gray-500">
                    {item.lesson.module.program.name} &rarr; {item.lesson.module.name}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleDelete(item.id)}
                className="text-red-500 hover:text-red-700 text-sm"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}