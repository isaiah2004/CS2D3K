"""Helper utilities for the API project."""
from dataclasses import dataclass


@dataclass
class Note:
    title: str
    links: list[str]


def backlinks(notes: list[Note], target: str) -> list[str]:
    return [n.title for n in notes if target in n.links]


if __name__ == "__main__":
    notes = [Note("Welcome", ["Graph overview"]), Note("Graph overview", ["Welcome"])]
    print(backlinks(notes, "Welcome"))
