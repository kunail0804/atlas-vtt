import React from 'react';
import { Tag } from 'lucide-react';
import { TagListSkeleton } from './TagListSkeleton';

/** A tag as the sidebar lists it. */
export interface SidebarTagItem {
  id: string;
  name: string;
  /** What the list shows once the tag is picked; 0 shows no count. */
  count: number;
}

interface SidebarTagListProps {
  items: readonly SidebarTagItem[];
  selectedIds: readonly string[];
  onSelect: (id: string) => void;
  /** Placeholders instead of the list. */
  loading: boolean;
  /** Neither placeholders nor the empty text: what the tags are is unknown. */
  failed: boolean;
  /** Said where no tag is listed. */
  emptyText: string;
}

/** The sidebar's tag buttons. */
export function SidebarTagList({ items, selectedIds, onSelect, loading, failed, emptyText }: SidebarTagListProps): React.JSX.Element {
  if (failed) return <div className="atlas-tags-list" />;
  if (loading) return <div className="atlas-tags-list"><TagListSkeleton /></div>;
  if (items.length === 0) {
    return (
      <div className="atlas-tags-list">
        <div className="atlas-tags-empty">
          <span className="atlas-tags-empty-text">{emptyText}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="atlas-tags-list">
      {items.map((tag) => {
        const selected = selectedIds.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            className={`atlas-tag-button ${selected ? 'atlas-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onSelect(tag.id); }}
            aria-pressed={selected}
          >
            <Tag className="atlas-tag-icon" />
            <span className="atlas-tag-text">{tag.name}</span>
            {tag.count > 0 && <span className="atlas-tag-count">{tag.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
