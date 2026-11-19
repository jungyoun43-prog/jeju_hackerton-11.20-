'use client';
import {useState} from 'react';
import {Check, Search, ChevronsUpDown} from 'lucide-react';
import {Button} from './ui/button';
import {Popover, PopoverContent, PopoverTrigger} from './ui/popover';
import {Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem} from './ui/command';

// 검색어는 이 컨트롤 안에서만 사용하며 지역·진료과의 허용값만 전달한다.
export function SearchPicker({id,label,value,options,onChange,placeholder='선택해 주세요',note}) {
  const [open,setOpen]=useState(false),selected=options.find(option=>option.value===value);
  return <div className="trip-field search-picker"><span id={`${id}-label`}>{label}</span><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={`${label} 검색·선택`} aria-controls={open?`${id}-list`:undefined}><Search aria-hidden="true"/><span>{selected?.label || placeholder}</span><ChevronsUpDown aria-hidden="true"/></Button></PopoverTrigger><PopoverContent align="start" className="department-popover search-popover" collisionPadding={12}><Command label={`${label} 검색`}><CommandInput placeholder={`${label} 검색`} aria-label={`${label} 검색`}/><CommandList id={`${id}-list`} aria-label={`${label} 목록`}><CommandEmpty>검색 결과가 없어요.<br/>검색어를 줄이거나 다른 이름을 입력해 주세요.</CommandEmpty><CommandGroup>{options.map(option=><CommandItem key={option.value} value={`${option.label} ${option.keywords || ''}`} onSelect={()=>{setOpen(false);onChange(option.value);}}><span>{option.label}</span>{option.value===value&&<Check aria-label="현재 선택"/>}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>{note&&<small className="department-note">{note}</small>}</div>;
}
